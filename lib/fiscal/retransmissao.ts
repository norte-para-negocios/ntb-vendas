import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { carregarCredenciaisFiscaisDaLoja } from '@/lib/fiscal/carregarCredenciaisFiscaisDaLoja';
import { transmitirNota } from '@/lib/fiscal/soap';
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
// transmitindo as MESMAS notas em paralelo. Reenviar o mesmo XML assinado
// não duplica documento na SEFAZ (a chave já foi processada, ela devolve o
// protocolo existente), mas duplicaria o trabalho de Fase 2 (PDF + upload
// pro Storage, que não é upsert) à toa. A trava é só desta instância —
// não é um lock distribuído, e não precisa ser: o app roda como um processo
// só.
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
 * - cStat presente e != '100' → rejeição de NEGÓCIO: a SEFAZ analisou e
 *   recusou este documento, e reenviar o mesmo XML vai recusar de novo pra
 *   sempre. Vira 'rejeitada' (estado terminal: a query desta função só pega
 *   'contingencia', então ela sai da fila naturalmente) pro lojista agir.
 * - cStat null (resposta sem código reconhecível) ou exceção de transporte →
 *   a SEFAZ nem chegou a analisar. Não mexe em nada, a linha continua
 *   'contingencia' e o próximo ciclo tenta de novo.
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
      } else if (resposta.cStat !== null) {
        const motivo = `cStat=${resposta.cStat} ${resposta.xMotivo ?? ''}`.trim();
        // `.eq('status', 'contingencia')` não é redundante com o filtro da
        // query lá em cima: é uma guarda de escrita contra corrida.
        // Confirmado ao vivo na homologação (2026-09-16): reenviar pra SEFAZ
        // uma chave JÁ autorizada não devolve o protocolo existente — devolve
        // `cStat=204 Duplicidade de NF-e`, uma rejeição de negócio. Se algum
        // dia esta instância não for mais única (dois processos/pods rodando
        // o mesmo intervalo), duas transmissões concorrentes da mesma nota
        // dariam 100 numa e 204 na outra, e a 204 chegando por último
        // marcaria como 'rejeitada' uma nota REALMENTE autorizada. Com a
        // guarda, o update simplesmente não pega a linha já promovida.
        const { error: updateErr } = await admin
          .from('fiscal_notas')
          .update({ status: 'rejeitada', motivo_erro: motivo })
          .eq('id', nota.id)
          .eq('status', 'contingencia');
        if (updateErr) {
          console.error(`Retransmissão fiscal: falha ao marcar nota ${nota.id} como rejeitada:`, updateErr);
        } else {
          console.error(`Retransmissão fiscal: nota ${nota.id} REJEITADA pela SEFAZ — ${motivo}`);
        }
      }
      // cStat === null: resposta sem código de negócio reconhecível (gateway
      // caído, corpo vazio) — a SEFAZ não analisou nada. Fica em contingência.
    } catch (e) {
      // Sem rede / SEFAZ fora / falha ao abrir o certificado: continua em
      // contingência e tenta no próximo ciclo. O try/catch é POR NOTA de
      // propósito — uma loja com certificado quebrado não pode impedir que as
      // notas das outras lojas sejam retransmitidas.
      console.error(`verificarNotasEmContingencia: falha ao retransmitir nota ${nota.id}:`, e);
    }
  }
}
