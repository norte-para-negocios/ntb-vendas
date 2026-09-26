import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  carregarMetadadosCertificadoDaLoja,
  extrairCertificadoDaLoja,
} from '@/lib/fiscal/carregarCredenciaisFiscaisDaLoja';
import {
  JUSTIFICATIVA_MAX,
  JUSTIFICATIVA_MIN,
  assinarEvento,
  ehCancelamentoHomologado,
  extrairAutorizacaoDoNfeProc,
  mensagemRejeicaoCancelamento,
  montarEventoCancelamento,
  montarProcEvento,
  normalizarJustificativa,
  transmitirEvento,
} from '@/lib/fiscal/cancelamento';
import { dentroDoPrazoCancelamento, mensagemPrazoEncerrado } from '@/lib/fiscal/prazoCancelamento';

// Até 30s de SOAP (lib/fiscal/cancelamento.ts) + download do .pfx/XML.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function falha(reason: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, reason, ...extra });
}

// Cancelamento de NF-e/NFC-e (evento 110111) — botão "Cancelar nota" em
// Administração → Notas fiscais. Mesmo padrão de app/api/fiscal/emitir:
// service role, sempre responde JSON (nunca 500 não tratado).
//
// Regras:
// - a nota tem que ser DESTA loja, estar 'autorizada', ter chave e protocolo;
// - o ambiente usado é o DA NOTA (fiscal_notas.ambiente, conferido contra o
//   tpAmb do XML autorizado), nunca o ambiente atual da loja — uma nota de
//   homologação continua sendo cancelada em homologação mesmo depois que a
//   loja virar pra produção;
// - prazo legal (lib/fiscal/prazoCancelamento.ts) checado ANTES de falar com
//   a SEFAZ, contado do dhRecbto do protocolo.
export async function POST(request: NextRequest) {
  try {
    return await cancelarNotaFiscal(request);
  } catch (e) {
    console.error('Cancelamento fiscal: falha não tratada na rota:', e);
    return falha(e instanceof Error ? e.message : 'Erro desconhecido ao cancelar a nota.');
  }
}

async function cancelarNotaFiscal(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as
    | { storeId?: unknown; notaId?: unknown; justificativa?: unknown }
    | null;
  const storeId = typeof body?.storeId === 'string' ? body.storeId : '';
  const notaId = typeof body?.notaId === 'string' ? body.notaId : '';
  if (!UUID.test(storeId) || !UUID.test(notaId)) return falha('Loja ou nota inválida.');

  const justificativa = normalizarJustificativa(typeof body?.justificativa === 'string' ? body.justificativa : '');
  if (justificativa.length < JUSTIFICATIVA_MIN) {
    return falha(`Escreva o motivo do cancelamento com pelo menos ${JUSTIFICATIVA_MIN} caracteres.`);
  }
  if (justificativa.length > JUSTIFICATIVA_MAX) {
    return falha(`O motivo do cancelamento pode ter no máximo ${JUSTIFICATIVA_MAX} caracteres.`);
  }

  const admin = getSupabaseAdmin();
  const { data: nota, error: notaErr } = await admin
    .from('fiscal_notas')
    .select('id, store_id, modelo, ambiente, status, chave_acesso, protocolo, xml_path, created_at')
    .eq('id', notaId)
    .maybeSingle();
  if (notaErr) return falha('Falha ao ler a nota fiscal.');
  if (!nota || nota.store_id !== storeId) return falha('Nota fiscal não encontrada nesta loja.');
  if (nota.status === 'cancelada') return falha('Esta nota já está cancelada.');
  if (nota.status !== 'autorizada') return falha('Só é possível cancelar uma nota autorizada pela SEFAZ.');

  const modelo = nota.modelo as '55' | '65';
  const ambiente = nota.ambiente as 'homologacao' | 'producao';
  const chave = String(nota.chave_acesso ?? '');
  const protocolo = String(nota.protocolo ?? '');
  if (!/^\d{44}$/.test(chave)) return falha('Esta nota não tem chave de acesso válida — não dá para cancelar.');
  if (!/^\d{15}$/.test(protocolo)) return falha('Esta nota não tem protocolo de autorização — não dá para cancelar.');
  if (chave.slice(0, 2) !== '29') return falha('Cancelamento implementado só para notas da Bahia.');
  if (chave.slice(20, 22) !== modelo) return falha('Modelo da nota não confere com a chave de acesso.');

  // Confere ambiente/protocolo/data de autorização no XML autorizado
  // (nfeProc no Storage). Sem XML (falha de pós-processamento na emissão),
  // usa o que está na linha e o created_at como início do prazo.
  let autorizadaEm: string = nota.created_at as string;
  if (nota.xml_path) {
    const { data: arquivo } = await admin.storage.from('fiscal-documentos').download(nota.xml_path as string);
    if (arquivo) {
      const aut = extrairAutorizacaoDoNfeProc(await arquivo.text());
      const tpAmbNota = ambiente === 'homologacao' ? '2' : '1';
      if (aut.tpAmb && aut.tpAmb !== tpAmbNota) {
        return falha('O ambiente gravado na nota não confere com o XML autorizado. Cancelamento bloqueado por segurança.');
      }
      if (aut.nProt && aut.nProt !== protocolo) {
        return falha('O protocolo gravado na nota não confere com o XML autorizado. Cancelamento bloqueado por segurança.');
      }
      if (aut.dhRecbto && !Number.isNaN(new Date(aut.dhRecbto).getTime())) autorizadaEm = aut.dhRecbto;
    }
  }

  if (!dentroDoPrazoCancelamento(modelo, autorizadaEm)) {
    return falha(mensagemPrazoEncerrado(modelo), { prazoEncerrado: true });
  }

  const meta = await carregarMetadadosCertificadoDaLoja(admin, storeId);
  if (!meta) return falha('A loja não tem certificado digital configurado.');
  let certificado;
  try {
    certificado = await extrairCertificadoDaLoja(admin, meta);
  } catch (e) {
    return falha(`Não foi possível abrir o certificado digital da loja: ${e instanceof Error ? e.message : 'erro'}`);
  }
  if (certificado.cnpjCertificado && certificado.cnpjCertificado !== chave.slice(6, 20)) {
    return falha('O certificado digital da loja não é do CNPJ que emitiu esta nota.');
  }

  const tpAmb = ambiente === 'homologacao' ? 2 : 1;
  const evento = montarEventoCancelamento({ chave, protocolo, justificativa, tpAmb });
  const eventoAssinado = assinarEvento(evento.xml, evento.id, certificado.certPem, certificado.keyPem);

  let resposta;
  try {
    resposta = await transmitirEvento({
      modelo,
      ambiente,
      eventoAssinado,
      certPem: certificado.certComCadeia,
      keyPem: certificado.keyPem,
    });
  } catch (e) {
    console.error('Cancelamento fiscal: falha de comunicação com a SEFAZ:', e);
    return falha(
      `Não foi possível falar com a SEFAZ agora (${e instanceof Error ? e.message : 'erro de rede'}). A nota continua autorizada; tente de novo.`,
    );
  }

  console.log(
    `[fiscal/cancelar] nota=${notaId} http=${resposta.httpStatus} lote=${resposta.cStatLote} cStat=${resposta.cStat} xMotivo=${resposta.xMotivo}`,
  );

  if (!ehCancelamentoHomologado(resposta.cStat) || !resposta.retEventoXml) {
    return falha(mensagemRejeicaoCancelamento(resposta.cStat, resposta.xMotivo), {
      cStat: resposta.cStat,
      xMotivo: resposta.xMotivo,
    });
  }

  // A partir daqui a nota ESTÁ cancelada na SEFAZ — qualquer falha abaixo
  // não pode esconder isso do lojista.
  const procEvento = montarProcEvento(eventoAssinado, resposta.retEventoXml);
  const canceladaEm =
    resposta.dhRegEvento && !Number.isNaN(new Date(resposta.dhRegEvento).getTime())
      ? new Date(resposta.dhRegEvento).toISOString()
      : new Date().toISOString();

  const { error: updErr } = await admin
    .from('fiscal_notas')
    .update({
      status: 'cancelada',
      cancelada_em: canceladaEm,
      cancelamento_protocolo: resposta.protocolo,
      cancelamento_justificativa: justificativa,
      cancelamento_xml: procEvento,
      updated_at: new Date().toISOString(),
    })
    .eq('id', notaId)
    .eq('status', 'autorizada');
  if (updErr) {
    console.error(
      `Cancelamento fiscal: CANCELADA na SEFAZ (chave=${chave}, protocolo evento=${resposta.protocolo}) mas falha ao gravar fiscal_notas:`,
      updErr,
    );
    return NextResponse.json({
      ok: true,
      cStat: resposta.cStat,
      xMotivo: resposta.xMotivo,
      protocolo: resposta.protocolo,
      aviso: `Nota cancelada na SEFAZ (protocolo ${resposta.protocolo}), mas houve falha ao atualizar a lista. Avise o suporte.`,
    });
  }

  // Libera os itens da venda (mesmo princípio da retransmissão quando a nota
  // é rejeitada): a nota cancelada não cobre mais nada, então uma nova
  // emissão para esses itens volta a ser possível.
  const { error: itensErr } = await admin.from('order_items').update({ fiscal_nota_id: null }).eq('fiscal_nota_id', notaId);
  if (itensErr) console.error(`Cancelamento fiscal: nota ${notaId} cancelada mas falha ao liberar order_items:`, itensErr);

  return NextResponse.json({
    ok: true,
    cStat: resposta.cStat,
    xMotivo: resposta.xMotivo,
    protocolo: resposta.protocolo,
    canceladaEm,
  });
}
