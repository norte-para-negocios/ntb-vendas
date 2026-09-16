import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { gerarPdfNota, montarNfeProc } from '@/lib/fiscal/pdf';

export interface DadosNotaAutorizada {
  storeId: string;
  modelo: '55' | '65';
  chave: string;
  numero: number;
  serie: number;
  xmlAssinado: string; // com <infNFeSupl> já inserido, se NFC-e
  protocoloXmlBruto: string; // resposta.xmlBruto de transmitirNota — de onde extrai <protNFe>
  protocolo: string | null;
  valorTotalComTaxa: number;
  notaBase: Record<string, unknown>; // campos comuns já montados por quem chama (order_id, table_id, ambiente, etc.)
  itensValidos: { id: string }[];
  // Se informado, faz UPDATE nesta linha (caminho de retransmissão);
  // se ausente, faz INSERT de uma linha nova (caminho síncrono de hoje).
  notaIdExistente?: string;
}

// Fase 2 da emissão fiscal: nota JÁ autorizada na SEFAZ (cStat=100), monta
// nfeProc, gera o PDF (DANFE/DANFCe) e sobe os dois pro Storage. Qualquer
// falha aqui vira só um motivo_erro informativo, nunca muda o status de
// 'autorizada' — nada aqui pode mudar o status pra 'erro'/'rejeitada' (ver
// comentário original em app/api/fiscal/emitir/route.ts). Compartilhado
// entre a emissão síncrona (INSERT, notaIdExistente ausente) e a
// retransmissão em background de uma nota que nasceu em contingência
// (UPDATE, notaIdExistente = id da linha 'contingencia' já existente).
export async function salvarNotaAutorizada(
  dados: DadosNotaAutorizada,
): Promise<{ notaId: string | null; motivoPosAutorizacao: string | null }> {
  const admin = getSupabaseAdmin();
  let xmlPath: string | null = null;
  let pdfPath: string | null = null;
  let motivoPosAutorizacao: string | null = null;

  try {
    const protXml = dados.protocoloXmlBruto.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? '';
    const nfeProc = montarNfeProc(dados.xmlAssinado, protXml);
    const pdfBuffer = await gerarPdfNota(dados.modelo, nfeProc);

    const caminhoXml = `${dados.storeId}/${dados.chave}.xml`;
    const caminhoPdf = `${dados.storeId}/${dados.chave}.pdf`;
    const [uploadXml, uploadPdf] = await Promise.all([
      admin.storage.from('fiscal-documentos').upload(caminhoXml, nfeProc, { contentType: 'application/xml' }),
      admin.storage.from('fiscal-documentos').upload(caminhoPdf, pdfBuffer, { contentType: 'application/pdf' }),
    ]);
    if (uploadXml.error) throw uploadXml.error;
    if (uploadPdf.error) throw uploadPdf.error;

    // Só marca os caminhos como válidos se AMBOS os uploads confirmaram —
    // um sucesso parcial (ex.: XML subiu, PDF falhou) não deixa metade da
    // informação enganosamente disponível; motivo_erro explica o que faltou.
    xmlPath = caminhoXml;
    pdfPath = caminhoPdf;
  } catch (e) {
    motivoPosAutorizacao = `Autorizada na SEFAZ mas falha ao gerar/salvar PDF: ${
      e instanceof Error ? e.message : 'erro desconhecido'
    }`;
    console.error('salvarNotaAutorizada: nota autorizada mas pós-processamento (PDF/storage) falhou:', e);
  }

  const linha = {
    ...dados.notaBase,
    valor_total: dados.valorTotalComTaxa,
    status: 'autorizada' as const,
    chave_acesso: dados.chave,
    numero: dados.numero,
    serie: dados.serie,
    protocolo: dados.protocolo,
    xml_path: xmlPath,
    pdf_path: pdfPath,
    motivo_erro: motivoPosAutorizacao,
  };

  const query = dados.notaIdExistente
    ? admin.from('fiscal_notas').update(linha).eq('id', dados.notaIdExistente).select('id').single()
    : admin.from('fiscal_notas').insert(linha).select('id').single();

  const { data: notaSalva, error: salvarErr } = await query;
  if (salvarErr) {
    // Pior caso: a nota está autorizada na SEFAZ de verdade, mas nem essa
    // linha de bookkeeping foi gravada — registra bem alto no log pra
    // alguém conseguir reconciliar manualmente (a chave/protocolo abaixo
    // aparecem no log, então não se perdem).
    console.error(
      `salvarNotaAutorizada: nota AUTORIZADA (chave=${dados.chave}, protocolo=${dados.protocolo}) mas falha ao gravar fiscal_notas:`,
      salvarErr,
    );
    return { notaId: null, motivoPosAutorizacao };
  }

  // Marca os itens cobertos por ESTA nota como faturados (migration 055) —
  // impede o fechamento final da mesa (caminho automático) de cobrar de
  // novo o que já saiu numa nota individual. Falha aqui não desfaz a nota
  // já autorizada (mesmo princípio de "nada pode virar erro depois do
  // cStat=100" do resto desta rota) — só loga, uma reconciliação manual
  // via fiscal_notas.id ainda é possível.
  const { error: marcarErr } = await admin
    .from('order_items')
    .update({ fiscal_nota_id: notaSalva.id })
    .in('id', dados.itensValidos.map((i) => i.id));
  if (marcarErr) {
    console.error(
      `salvarNotaAutorizada: nota AUTORIZADA (chave=${dados.chave}) mas falha ao marcar order_items.fiscal_nota_id=${notaSalva.id}:`,
      marcarErr,
    );
  }

  return { notaId: notaSalva.id, motivoPosAutorizacao };
}
