import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { carregarCredenciaisFiscaisDaLoja } from '@/lib/fiscal/carregarCredenciaisFiscaisDaLoja';
import { transmitirNota, ehSefazIndisponivel } from '@/lib/fiscal/soap';
import { salvarNotaAutorizada } from '@/lib/fiscal/salvarNotaAutorizada';

// Linha de fiscal_notas em contingência, com só o que a retransmissão lê.
interface NotaPendente {
  id: string;
  store_id: string;
  order_id: string | null;
  table_id: string | null;
  modelo: '55' | '65';
  ambiente: 'homologacao' | 'producao';
  chave_acesso: string | null;
  numero: number | null;
  serie: number | null;
  xml_contingencia: string | null;
}

// Trava de ciclo (processo único, systemd no Contabo — ver instrumentation.ts).
// O setInterval não espera o ciclo anterior terminar: com muitas notas
// pendentes e SEFAZ lenta (timeout de 30s por nota em lib/fiscal/soap.ts),
// um ciclo pode passar dos 2 minutos e o próximo entraria por cima,
// transmitindo as MESMAS notas em paralelo.
//
// Isso é pior do que só desperdício de trabalho: confirmado ao vivo na
// homologação (2026-09-16), reenviar pra SEFAZ uma chave JÁ autorizada NÃO
// devolve o protocolo existente — devolve `cStat=204 Duplicidade de NF-e`,
// uma rejeição de NEGÓCIO. Duas transmissões concorrentes da mesma nota
// dariam 100 numa e 204 na outra, e a 204 chegando por último tentaria
// marcar como 'rejeitada' uma nota REALMENTE autorizada (ver a guarda
// `.eq('status','contingencia')` no UPDATE de rejeição mais abaixo, que é a
// defesa no nível do banco pra isso). A trava é só desta instância — não é
// um lock distribuído, e não precisa ser: o app roda como um processo só.
let cicloEmExecucao = false;

/**
 * Retransmite pra SEFAZ as notas que foram emitidas em contingência offline
 * (tpEmis=9) enquanto a rede/SEFAZ estava fora. Chamada a cada 2 minutos pelo
 * `setInterval` de `instrumentation.ts`, e exportada pra poder ser exercitada
 * isoladamente por script/teste.
 *
 * O XML retransmitido é EXATAMENTE o `xml_contingencia` gravado na emissão —
 * nunca remontado, nunca re-assinado, nunca alterado. Ele já nasce completo e
 * transmissível (com `<dhCont>`/`<xJust>` e, em NFC-e, o `<infNFeSupl>` com o
 * QR Code offline — ver `emitirEmContingencia` em app/api/fiscal/emitir/route.ts);
 * qualquer alteração aqui invalidaria a assinatura digital.
 *
 * Desfechos possíveis por nota:
 * - cStat '100' → promove a linha pra 'autorizada' via `salvarNotaAutorizada`
 *   (mesmo caminho da emissão online: monta nfeProc, gera o DANFE/DANFCe
 *   oficial e sobe XML+PDF pro Storage), agora com protocolo real.
 * - cStat presente, != '100' e que NÃO seja de indisponibilidade da SEFAZ
 *   (ver `ehSefazIndisponivel` em lib/fiscal/soap.ts) → rejeição de NEGÓCIO:
 *   a SEFAZ analisou e recusou este documento, e reenviar o mesmo XML vai
 *   recusar de novo pra sempre. Vira 'rejeitada' (estado terminal: a query
 *   desta função só pega 'contingencia', então ela sai da fila naturalmente)
 *   pro lojista agir — e os `order_items` desta nota são LIBERADOS
 *   (fiscal_nota_id = null), senão a venda ficaria presa a um documento
 *   morto e nenhuma emissão futura (nem o botão "Reemitir") conseguiria
 *   pegá-la de novo.
 * - cStat null, cStat de indisponibilidade (105/106/108/109) ou exceção de
 *   transporte → a SEFAZ nem chegou a analisar. Não mexe em nada, a linha
 *   continua 'contingencia' e o próximo ciclo tenta de novo.
 *
 * Não existe desistência automática ("expira depois de N horas"): até quando
 * vale a pena retransmitir é decisão legal/fiscal, não de código. O caminho de
 * intervenção humana já existe — o painel admin (Task 8) alerta quando uma
 * nota passa de 2h em contingência.
 */
export async function verificarNotasEmContingencia(): Promise<void> {
  if (cicloEmExecucao) {
    console.warn('verificarNotasEmContingencia: ciclo anterior ainda rodando, pulando este.');
    return;
  }
  cicloEmExecucao = true;
  try {
    await executarCiclo();
  } finally {
    cicloEmExecucao = false;
  }
}

async function executarCiclo(): Promise<void> {
  const admin = getSupabaseAdmin();

  const { data: pendentes, error } = await admin
    .from('fiscal_notas')
    .select('id, store_id, order_id, table_id, modelo, ambiente, chave_acesso, numero, serie, xml_contingencia')
    .eq('status', 'contingencia');

  if (error) {
    console.error('verificarNotasEmContingencia: falha ao buscar pendentes:', error);
    return;
  }
  if (!pendentes?.length) return;

  for (const nota of pendentes as unknown as NotaPendente[]) {
    // Linha em contingência sem XML não é retransmissível por definição (nem
    // deveria existir — emitirEmContingencia só grava 'contingencia' depois de
    // montar e assinar o XML). Loga uma vez por ciclo em vez de falhar calado.
    if (!nota.xml_contingencia || !nota.chave_acesso || nota.numero === null || nota.serie === null) {
      console.error(
        `verificarNotasEmContingencia: nota ${nota.id} em contingência sem xml/chave/numero/serie — ignorada.`,
      );
      continue;
    }

    try {
      const { certComCadeia, keyPem } = await carregarCredenciaisFiscaisDaLoja(admin, nota.store_id);

      // `ambiente` vem da LINHA, não da config atual da loja: o tpAmb está
      // assado dentro do XML assinado e da chave de acesso. Se a loja tivesse
      // virado a chave homologação→produção entre a emissão e este ciclo,
      // usar a config atual mandaria o documento pro endpoint errado.
      const resposta = await transmitirNota({
        modelo: nota.modelo,
        ambiente: nota.ambiente,
        xmlAssinadoComSupl: nota.xml_contingencia,
        certPem: certComCadeia,
        keyPem,
      });

      if (resposta.cStat === '100') {
        // Itens já vinculados a ESTA nota no momento da emissão em
        // contingência (emitirEmContingencia grava order_items.fiscal_nota_id),
        // então basta relê-los — nunca recalcular quais itens eram.
        const { data: itens } = await admin.from('order_items').select('id').eq('fiscal_nota_id', nota.id);

        const { notaId, motivoPosAutorizacao } = await salvarNotaAutorizada({
          storeId: nota.store_id,
          modelo: nota.modelo,
          chave: nota.chave_acesso,
          numero: nota.numero,
          serie: nota.serie,
          xmlAssinado: nota.xml_contingencia,
          protocoloXmlBruto: resposta.xmlBruto,
          protocolo: resposta.protocolo,
          // Ignorado no caminho de UPDATE (notaIdExistente presente) — a linha
          // em contingência já tem o valor_total certo. Ver salvarNotaAutorizada.
          valorTotalComTaxa: 0,
          notaBase: {
            store_id: nota.store_id,
            order_id: nota.order_id,
            table_id: nota.table_id,
            modelo: nota.modelo,
            ambiente: nota.ambiente,
          },
          itensValidos: itens ?? [],
          notaIdExistente: nota.id,
        });

        console.log(
          `Retransmissão fiscal: nota ${nota.id} (chave=${nota.chave_acesso}) AUTORIZADA, protocolo=${resposta.protocolo}` +
            (notaId ? '' : ' — ATENÇÃO: falha ao gravar a linha, ver log acima') +
            (motivoPosAutorizacao ? ` — ${motivoPosAutorizacao}` : ''),
        );

        if (notaId) await marcarLacunaOmie(admin, nota.store_id, notaId);
      } else if (resposta.cStat !== null && !ehSefazIndisponivel(resposta.cStat)) {
        // Rejeição de NEGÓCIO de verdade. `ehSefazIndisponivel` exclui daqui
        // os códigos de serviço fora do ar (105/106/108/109): esses NÃO são
        // recusa do documento, são "a SEFAZ está indisponível agora" — a
        // condição que esta feature inteira existe pra sobreviver. Antes
        // desta correção eles caíam aqui e matavam a nota como 'rejeitada'
        // pra sempre.
        const motivo = `cStat=${resposta.cStat} ${resposta.xMotivo ?? ''}`.trim();
        // `.eq('status', 'contingencia')` não é redundante com o filtro da
        // query lá em cima: é uma guarda de escrita contra corrida. Entre o
        // SELECT do início do ciclo e este UPDATE, a linha pode ter sido
        // promovida pra 'autorizada' (por uma transmissão concorrente desta
        // mesma nota — ver o comentário de `cicloEmExecucao` no topo). Sem a
        // guarda, esta escrita, trabalhando em cima de uma leitura já
        // obsoleta, sobrescreveria uma nota REALMENTE autorizada com
        // 'rejeitada'. Com ela, o WHERE simplesmente não casa e nada é
        // escrito — condição atômica no Postgres, não um read-then-write.
        const { error: updateErr } = await admin
          .from('fiscal_notas')
          .update({ status: 'rejeitada', motivo_erro: motivo })
          .eq('id', nota.id)
          .eq('status', 'contingencia');
        if (updateErr) {
          console.error(`Retransmissão fiscal: falha ao marcar nota ${nota.id} como rejeitada:`, updateErr);
        } else {
          console.error(`Retransmissão fiscal: nota ${nota.id} REJEITADA pela SEFAZ — ${motivo}`);

          // Libera os itens desta nota morta. emitirEmContingencia gravou
          // order_items.fiscal_nota_id no momento da emissão em contingência
          // — ANTES de existir qualquer decisão da SEFAZ. A query que acha
          // "itens ainda sem nota" em app/api/fiscal/emitir/route.ts filtra
          // `.is('fiscal_nota_id', null)`, então deixar o vínculo apontando
          // pra uma nota 'rejeitada' excluiria esses itens PRA SEMPRE de
          // qualquer emissão futura — nem uma nova tentativa automática nem
          // o botão "Reemitir" conseguiriam pegá-los. Falha aqui não desfaz
          // a rejeição (a nota está morta de qualquer jeito), só loga.
          const { error: liberarErr } = await admin
            .from('order_items')
            .update({ fiscal_nota_id: null })
            .eq('fiscal_nota_id', nota.id);
          if (liberarErr) {
            console.error(
              `Retransmissão fiscal: nota ${nota.id} rejeitada mas falha ao liberar order_items.fiscal_nota_id (itens ficam presos a uma nota morta):`,
              liberarErr,
            );
          }
        }
      }
      // cStat null, ou cStat de indisponibilidade da SEFAZ (105/106/108/109):
      // a SEFAZ não analisou nada — gateway caído, corpo vazio, serviço
      // paralisado. Não mexe em nada, a linha fica em contingência e o
      // próximo ciclo tenta de novo.
    } catch (e) {
      // Sem rede / SEFAZ fora / falha ao abrir o certificado: continua em
      // contingência e tenta no próximo ciclo. O try/catch é POR NOTA de
      // propósito — uma loja com certificado quebrado não pode impedir que as
      // notas das outras lojas sejam retransmitidas.
      console.error(`verificarNotasEmContingencia: falha ao retransmitir nota ${nota.id}:`, e);
    }
  }
}

const MARCADOR_OMIE = ' — não enviada ao Omie (promovida em contingência)';

/**
 * Lacuna CONHECIDA e deliberada: quando uma nota nasce em contingência e é
 * promovida aqui em background, a integração com o Omie/ntb-estoque NÃO
 * dispara — diferente do caminho online síncrono de
 * app/api/fiscal/emitir/route.ts, que dispara via `after()` depois do
 * cStat=100. O motivo de não disparar aqui é correto e continua valendo:
 * `montarPayloadIncluirNfce` precisa de itens/pagamentos/`dataEmissao` que só
 * existem no contexto síncrono original, e usar a hora da RETRANSMISSÃO como
 * dataEmissao lançaria a venda no sistema contábil do cliente com data errada,
 * horas depois do fato. Reconstruir isso direito (derivar tudo do nfeProc XML,
 * num `lib/fiscal/enviarNotaParaOmie.ts` compartilhado pelos dois caminhos) é
 * trabalho futuro de verdade, não um remendo pra fazer aqui.
 *
 * O que esta função conserta é a INVISIBILIDADE da lacuna: até agora ela era
 * 100% silenciosa — nada no banco nem na UI indicava que aquela nota ficou de
 * fora do Omie, e o lojista só descobriria conciliando manualmente. Aqui,
 * quando a loja de fato tem integração configurada (mesma checagem do caminho
 * online: `store_ntb_estoque_secrets.ativo`, ou a mera existência de
 * `store_omie_secrets`), um marcador é ANEXADO ao `motivo_erro` já composto
 * pela promoção (`salvarNotaAutorizada` preserva ali o motivo original da
 * contingência) — nunca sobrescrevendo o que estava lá.
 *
 * Melhor esforço: qualquer falha aqui só loga. A nota está autorizada de
 * verdade e nada neste caminho pode mudar isso.
 */
async function marcarLacunaOmie(
  admin: ReturnType<typeof getSupabaseAdmin>,
  storeId: string,
  notaId: string,
): Promise<void> {
  try {
    const { data: ntbEstoqueSecret } = await admin
      .from('store_ntb_estoque_secrets')
      .select('ativo')
      .eq('store_id', storeId)
      .maybeSingle();

    let temIntegracao = Boolean(ntbEstoqueSecret?.ativo);
    if (!temIntegracao) {
      const { data: omieSecret } = await admin
        .from('store_omie_secrets')
        .select('store_id')
        .eq('store_id', storeId)
        .maybeSingle();
      temIntegracao = Boolean(omieSecret);
    }
    if (!temIntegracao) return;

    // Relê o motivo_erro que a promoção acabou de compor, pra ANEXAR em vez
    // de clobberar (ver preservação do motivo original em
    // lib/fiscal/salvarNotaAutorizada.ts).
    const { data: notaAtual } = await admin.from('fiscal_notas').select('motivo_erro').eq('id', notaId).single();
    const motivoAtual = (notaAtual?.motivo_erro as string | null) ?? null;
    if (motivoAtual?.includes(MARCADOR_OMIE)) return; // idempotente

    const { error: updateErr } = await admin
      .from('fiscal_notas')
      .update({ motivo_erro: motivoAtual ? `${motivoAtual}${MARCADOR_OMIE}` : MARCADOR_OMIE.replace(/^ — /, '') })
      .eq('id', notaId);
    if (updateErr) {
      console.error(`Retransmissão fiscal: falha ao marcar lacuna do Omie na nota ${notaId}:`, updateErr);
    } else {
      console.warn(
        `Retransmissão fiscal: nota ${notaId} promovida em contingência NÃO foi enviada ao Omie/ntb-estoque (loja ${storeId} tem integração configurada) — lançamento precisa ser conferido manualmente.`,
      );
    }
  } catch (e) {
    console.error(`Retransmissão fiscal: falha ao checar integração Omie da loja ${storeId}:`, e);
  }
}
