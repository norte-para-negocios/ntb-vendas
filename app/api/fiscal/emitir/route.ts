import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { extrairCertificado } from '@/lib/fiscal/certificado';
import { montarXmlNota, ItemNota } from '@/lib/fiscal/xml';
import { assinarXmlNota } from '@/lib/fiscal/assinatura';
import { montarQrCode, inserirSuplNoXmlAssinado } from '@/lib/fiscal/qrcode';
import { transmitirNota } from '@/lib/fiscal/soap';
import { gerarPdfNota, montarNfeProc } from '@/lib/fiscal/pdf';

interface RequestBody {
  orderId?: string;
  tableId?: string;
  // Só usado pra NF-e (modelo 55) — captura ainda não existe na UI (Task 17);
  // aceito aqui desde já pra não precisar mexer no contrato da rota depois.
  destinatario?: { cpfCnpj: string; nome: string };
}

// Orquestra a emissão fiscal (NFC-e/NF-e) de um pedido fechado — chamado
// fire-and-forget por closeTableSession/closeCounterOrder (Task 14), depois
// que o pedido JÁ fechou de verdade. Mesmo princípio de sempre neste projeto
// (ver app/api/integracao/ordem-producao/route.ts): esta rota nunca pode
// impedir o fechamento nem propagar uma exceção não tratada — toda saída,
// inclusive falha total, resolve num JSON (o handler externo abaixo garante
// isso mesmo se algo neste arquivo tiver um bug).
//
// ─── Por que duas fases de erro, não uma só ───────────────────────────────
// A partir do momento em que transmitirNota() devolve cStat === '100', um
// documento fiscal REAL e juridicamente válido passou a existir na SEFAZ,
// com chave de acesso e protocolo definitivos — isso é verdade
// independente de qualquer coisa que aconteça depois (gerar o PDF, subir
// pro Storage). Por isso o pipeline é dividido em duas fases com
// try/catch SEPARADOS:
//
//   FASE 1 (numeração → XML → assinatura → QR → transmissão): nenhum
//   documento existe até o fim dela. Qualquer erro aqui — exceção ou
//   cStat != '100' — é seguro registrar como 'erro'/'rejeitada': uma
//   reemissão futura vai pegar um número novo, sem risco de duplicar nada
//   na SEFAZ.
//
//   FASE 2 (montar nfeProc → gerar PDF → subir XML+PDF pro Storage): já
//   existe um documento autorizado. Um erro aqui (bug de biblioteca,
//   Storage fora do ar, DANFE de NF-e sem endereço do destinatário — ver
//   limitação conhecida abaixo) NUNCA pode fazer a linha cair como 'erro',
//   porque isso levaria uma reemissão futura a gerar um SEGUNDO documento
//   autorizado pro mesmo pedido (número duplicado = problema real de
//   compliance perante a SEFAZ). A linha sempre grava 'autorizada' com os
//   dados reais da nota; só xml_path/pdf_path ficam null, e o motivo do
//   problema de pós-processamento fica visível em motivo_erro.
//
// ─── Limitação conhecida (não é bug, não corrigir aqui) ───────────────────
// DestinatarioNota (modelo 55) só tem {cpfCnpj, nome} — sem endereço. A
// biblioteca de PDF (node-sped-pdf/DANFe) lê dest.enderDest.xLgr sem
// checagem e lança se não existir. Ou seja: pra modelo 55, é ESPERADO que
// a Fase 2 falhe hoje (endereço do destinatário ainda não é capturado —
// isso é trabalho de uma task futura). Graças à separação de fases acima,
// isso vira 'autorizada' com pdf_path null, nunca 'erro'.
export async function POST(request: NextRequest) {
  try {
    return await emitirNotaFiscal(request);
  } catch (e) {
    // Rede de segurança final: nenhum bug de código nesta rota pode virar
    // um 500 não tratado (constraint do Task 13) — sempre volta JSON.
    console.error('Emissão fiscal: falha não tratada na rota:', e);
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : 'Erro desconhecido' });
  }
}

async function emitirNotaFiscal(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.orderId && !body?.tableId) {
    return NextResponse.json({ skipped: true, reason: 'orderId ou tableId ausente' });
  }

  const admin = getSupabaseAdmin();

  // 1. Resolve store_id e os itens da venda.
  let storeId: string | null = null;
  let orderIds: string[] = [];

  if (body.orderId) {
    const { data: order } = await admin.from('orders').select('id, store_id').eq('id', body.orderId).maybeSingle();
    if (order) {
      storeId = order.store_id;
      orderIds = [order.id];
    }
  } else if (body.tableId) {
    // Mesma janela de 5 min de app/api/integracao/ordem-producao/route.ts —
    // evita pegar pedidos de uma sessão anterior da mesma mesa.
    const { data: orders } = await admin
      .from('orders')
      .select('id, store_id')
      .eq('table_id', body.tableId)
      .eq('status', 'delivered')
      .gte('updated_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
    if (orders?.length) {
      storeId = orders[0].store_id;
      orderIds = orders.map((o) => o.id);
    }
  }

  if (!storeId || !orderIds.length) {
    return NextResponse.json({ skipped: true, reason: 'Pedido(s) não encontrado(s)' });
  }

  // 2. Config da loja — decide SE emite e QUAL modelo.
  const { data: config } = await admin.from('store_fiscal_config').select('*').eq('store_id', storeId).maybeSingle();
  if (!config || config.modelo_emissao_automatica === 'nenhuma') {
    return NextResponse.json({ skipped: true, reason: 'Loja sem emissão automática configurada' });
  }
  const modelo: '55' | '65' = config.modelo_emissao_automatica === 'nfe' ? '55' : '65';
  const serie = modelo === '55' ? config.nfe_serie : config.nfce_serie;
  if (!serie) {
    return NextResponse.json({ skipped: true, reason: `Série do modelo ${modelo} não configurada` });
  }

  // 3. Certificado + senha + cadeia.
  const { data: certMeta } = await admin
    .from('store_fiscal_certificates')
    .select('file_path, chain_pem')
    .eq('store_id', storeId)
    .maybeSingle();
  const { data: certSecret } = await admin
    .from('store_fiscal_certificate_secrets')
    .select('password')
    .eq('store_id', storeId)
    .maybeSingle();

  if (!certMeta || !certSecret?.password) {
    return NextResponse.json({ skipped: true, reason: 'Loja sem certificado digital configurado' });
  }

  // 4. Itens da venda (com NCM do produto).
  const { data: items } = await admin
    .from('order_items')
    .select('quantity, status, price_at_time, product:products(id, name, ncm)')
    .in('order_id', orderIds);

  const itensValidos = (items ?? []).filter((i) => i.status !== 'canceled');
  if (!itensValidos.length) {
    return NextResponse.json({ skipped: true, reason: 'Nenhum item pra emitir' });
  }

  const itemSemNcm = itensValidos.find((i) => !(i as any).product?.ncm);
  const valorTotal = itensValidos.reduce((soma, i) => soma + i.quantity * Number(i.price_at_time), 0);

  const notaBase = {
    store_id: storeId,
    table_id: body.tableId ?? null,
    order_id: body.tableId ? null : orderIds[0],
    modelo,
    ambiente: config.ambiente as 'homologacao' | 'producao',
    valor_total: valorTotal,
  };

  if (itemSemNcm) {
    const { error: insertErr } = await admin.from('fiscal_notas').insert({
      ...notaBase,
      status: 'erro',
      motivo_erro: `Produto "${(itemSemNcm as any).product?.name}" sem NCM cadastrado.`,
    });
    if (insertErr) console.error('Emissão fiscal: falha ao gravar fiscal_notas (item sem NCM):', insertErr);
    return NextResponse.json({ ok: false, reason: 'Item sem NCM' });
  }

  // ════════════════════════════════════════════════════════════════════════
  // FASE 1 — numeração, montagem/assinatura do XML e transmissão à SEFAZ.
  // Nenhum documento fiscal existe até esta fase terminar com cStat=100.
  // Qualquer falha aqui (exceção OU rejeição da SEFAZ) é segura de marcar
  // como 'erro'/'rejeitada': uma reemissão futura pega numeração nova, sem
  // nenhum documento órfão do lado da SEFAZ.
  // ════════════════════════════════════════════════════════════════════════
  let chave: string;
  let numero: number;
  let xmlAssinado: string;
  let resposta: Awaited<ReturnType<typeof transmitirNota>>;

  try {
    // 5. Numeração atômica.
    const { data: numeroGerado, error: numeroErr } = await admin.rpc('increment_fiscal_numero_secure', {
      p_store_id: storeId,
      p_modelo: modelo,
    });
    if (numeroErr) throw new Error(`Falha ao gerar numeração fiscal: ${numeroErr.message}`);
    numero = numeroGerado as number;

    // 6. Monta itens do XML.
    const itensXml: ItemNota[] = itensValidos.map((i) => ({
      cProd: String((i as any).product.id).slice(0, 8),
      xProd: (i as any).product.name,
      ncm: (i as any).product.ncm,
      qCom: i.quantity,
      vUnCom: Number(i.price_at_time),
    }));

    // 7. Certificado.
    const certBucket = admin.storage.from('store-certificates');
    const { data: pfxFile, error: pfxErr } = await certBucket.download(certMeta.file_path);
    if (pfxErr || !pfxFile) throw new Error('Não foi possível baixar o certificado digital.');
    const pfxBuffer = Buffer.from(await pfxFile.arrayBuffer());
    const { certPem, keyPem } = extrairCertificado(pfxBuffer, certSecret.password);
    const certComCadeia = certMeta.chain_pem ? `${certPem}\n${certMeta.chain_pem}` : certPem;

    // 8. Monta e assina o XML.
    const montado = montarXmlNota({
      modelo,
      ambiente: config.ambiente,
      serie,
      numero,
      emitente: {
        cnpj: (config.cnpj_autorizado || '').replace(/\D/g, ''),
        ie: config.inscricao_estadual || '',
        razaoSocial: config.razao_social || '',
        logradouro: config.endereco_logradouro || '',
        numero: config.endereco_numero || 'S/N',
        bairro: config.endereco_bairro || '',
        municipio: config.endereco_cidade || '',
        // TODO: mapear UF/município -> código IBGE quando expandir além da
        // BA/Mata de São João (fora de escopo desta task, ver AGENTS.md).
        cMun: '2921005',
        uf: config.endereco_uf || 'BA',
        cep: (config.endereco_cep || '').replace(/\D/g, ''),
        cUF: 29,
        cstCsosnPadrao: config.cst_csosn_padrao || '102',
        cstPisPadrao: config.cst_pis_padrao || '07',
        cstCofinsPadrao: config.cst_cofins_padrao || '07',
        autXmlCnpj: undefined,
      },
      itens: itensXml,
      destinatario: modelo === '55' ? body.destinatario : undefined,
    });
    chave = montado.chave;

    xmlAssinado = assinarXmlNota(montado.xml, montado.infNFeId, certPem, keyPem);

    // 9. QR Code (só NFC-e).
    if (modelo === '65') {
      const { data: fiscalSecret } = await admin
        .from('store_fiscal_config_secrets')
        .select('csc_homologacao, cscid_homologacao, csc_producao, cscid_producao')
        .eq('store_id', storeId)
        .maybeSingle();
      const csc = config.ambiente === 'homologacao' ? fiscalSecret?.csc_homologacao : fiscalSecret?.csc_producao;
      const idCsc =
        config.ambiente === 'homologacao' ? fiscalSecret?.cscid_homologacao : fiscalSecret?.cscid_producao;
      if (!csc || !idCsc) throw new Error('CSC/CSCID não configurado pro ambiente atual da loja.');

      const { supl } = montarQrCode({
        chave,
        tpAmb: config.ambiente === 'homologacao' ? 2 : 1,
        idCsc,
        csc,
        urlQrCode: 'http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx',
        urlChave: 'http://hinternet.sefaz.ba.gov.br/nfce/consulta',
      });
      xmlAssinado = inserirSuplNoXmlAssinado(xmlAssinado, supl);
    }

    // 10. Transmite.
    resposta = await transmitirNota({
      modelo,
      ambiente: config.ambiente,
      xmlAssinadoComSupl: xmlAssinado,
      certPem: certComCadeia,
      keyPem,
    });
  } catch (e) {
    const { error: insertErr } = await admin.from('fiscal_notas').insert({
      ...notaBase,
      status: 'erro',
      motivo_erro: e instanceof Error ? e.message : 'Erro desconhecido na emissão.',
    });
    if (insertErr) console.error('Emissão fiscal: falha ao gravar fiscal_notas (erro pré-autorização):', insertErr);
    console.error('Emissão fiscal falhou (fase pré-autorização):', e);
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : 'Erro desconhecido' });
  }

  if (resposta.cStat !== '100') {
    // cStat null = a resposta não trouxe um código de negócio reconhecível
    // (ex.: página de erro HTML, corpo vazio, transporte quebrado no meio) —
    // não é uma rejeição de negócio de verdade, então não afirmamos
    // 'rejeitada' (que implicaria "a SEFAZ analisou e recusou"); tratamos
    // como 'erro' igual a uma falha pré-transmissão. Com cStat presente e
    // diferente de '100', é uma rejeição de negócio real da SEFAZ.
    const status: 'rejeitada' | 'erro' = resposta.cStat ? 'rejeitada' : 'erro';
    const motivo = resposta.cStat
      ? `cStat=${resposta.cStat} ${resposta.xMotivo ?? ''}`.trim()
      : `Falha de transporte na transmissão pra SEFAZ (HTTP ${resposta.httpStatus}).`;

    const { error: insertErr } = await admin.from('fiscal_notas').insert({
      ...notaBase,
      status,
      chave_acesso: chave,
      numero,
      serie,
      motivo_erro: motivo,
    });
    if (insertErr) console.error('Emissão fiscal: falha ao gravar fiscal_notas (rejeição/erro de transmissão):', insertErr);
    return NextResponse.json({ ok: false, cStat: resposta.cStat, xMotivo: resposta.xMotivo });
  }

  // ════════════════════════════════════════════════════════════════════════
  // A partir daqui, cStat === '100': a nota está AUTORIZADA de verdade na
  // SEFAZ, com chave/protocolo definitivos. Nada a partir deste ponto pode
  // fazer a linha gravar como 'erro'/'rejeitada' — ver comentário no topo
  // do arquivo pro porquê (duplicação de documento fiscal numa reemissão
  // futura seria um problema real de compliance).
  // ════════════════════════════════════════════════════════════════════════

  // FASE 2 — monta nfeProc, gera o PDF (DANFE/DANFCe) e sobe os dois pro
  // Storage. Qualquer falha aqui vira só um motivo_erro informativo,
  // nunca muda o status de 'autorizada'.
  let xmlPath: string | null = null;
  let pdfPath: string | null = null;
  let motivoPosAutorizacao: string | null = null;

  try {
    const protXml = resposta.xmlBruto.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? '';
    const nfeProc = montarNfeProc(xmlAssinado, protXml);
    const pdfBuffer = await gerarPdfNota(modelo, nfeProc);

    const caminhoXml = `${storeId}/${chave}.xml`;
    const caminhoPdf = `${storeId}/${chave}.pdf`;
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
    console.error('Emissão fiscal: nota autorizada mas pós-processamento (PDF/storage) falhou:', e);
  }

  const { error: insertErr } = await admin.from('fiscal_notas').insert({
    ...notaBase,
    status: 'autorizada',
    chave_acesso: chave,
    numero,
    serie,
    protocolo: resposta.protocolo,
    xml_path: xmlPath,
    pdf_path: pdfPath,
    motivo_erro: motivoPosAutorizacao,
  });
  if (insertErr) {
    // Pior caso: a nota está autorizada na SEFAZ de verdade, mas nem essa
    // linha de bookkeeping foi gravada — registra bem alto no log pra
    // alguém conseguir reconciliar manualmente (a chave/protocolo abaixo
    // aparecem no log, então não se perdem).
    console.error(
      `Emissão fiscal: nota AUTORIZADA (chave=${chave}, protocolo=${resposta.protocolo}) mas falha ao gravar fiscal_notas:`,
      insertErr,
    );
  }

  return NextResponse.json({
    ok: true,
    chave,
    protocolo: resposta.protocolo,
    ...(motivoPosAutorizacao ? { pdfWarning: motivoPosAutorizacao } : {}),
  });
}
