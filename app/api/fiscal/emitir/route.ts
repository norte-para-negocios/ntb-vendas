import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { extrairCertificado } from '@/lib/fiscal/certificado';
import { montarXmlNota, ItemNota } from '@/lib/fiscal/xml';
import { assinarXmlNota } from '@/lib/fiscal/assinatura';
import { montarQrCode, inserirSuplNoXmlAssinado } from '@/lib/fiscal/qrcode';
import { transmitirNota, resolverEndpointsNfceConsulta } from '@/lib/fiscal/soap';
import { gerarPdfNota, montarNfeProc } from '@/lib/fiscal/pdf';

// O pipeline completo (download+parse de certificado, XML, assinatura,
// SOAP até 30s pra SEFAZ, geração de PDF) pode passar do limite padrão de
// function serverless (10-15s) — se a function fosse morta DEPOIS da
// autorização (documento real já existe na SEFAZ) mas ANTES do insert em
// fiscal_notas, o documento ficaria sem NENHUM rastro no sistema (pior que
// qualquer falha da Fase 2, que pelo menos grava a linha). 60s dá folga
// real sobre o pior caso (30s de soap.ts + margem).
export const maxDuration = 60;

interface RequestBody {
  orderId?: string;
  tableId?: string;
  // Só usado pra NF-e (modelo 55) — captura opcional na UI (Task 17: modal de
  // fechar mesa/balcão, só quando modelo_emissao_automatica === 'nfe').
  // Ausente/vazio em modelo 55 não é mais um erro genérico: ver a checagem
  // logo antes da FASE 1 abaixo, que grava 'pendente' em vez de lançar.
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
    // `.order('created_at')` é NECESSÁRIO (não só estético): `orderIds[0]`
    // vira a "âncora" que identifica esta venda especificamente (ver
    // notaBase abaixo) — sem ordenação explícita, a ordem devolvida pelo
    // Postgres não é garantida estável entre duas execuções da mesma query,
    // o que quebraria a checagem de idempotência (duas chamadas pra a MESMA
    // sessão de fechamento poderiam resolver âncoras diferentes e não se
    // reconhecerem como a mesma venda).
    const { data: orders } = await admin
      .from('orders')
      .select('id, store_id')
      .eq('table_id', body.tableId)
      .eq('status', 'delivered')
      .gte('updated_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true });
    if (orders?.length) {
      storeId = orders[0].store_id;
      orderIds = orders.map((o) => o.id);
    }
  }

  if (!storeId || !orderIds.length) {
    return NextResponse.json({ skipped: true, reason: 'Pedido(s) não encontrado(s)' });
  }

  // 1.5. Guarda de idempotência — nada nesta rota impede que o mesmo
  // orderId/tableId seja chamado duas vezes (retry de rede do fire-and-
  // forget que vai chamar essa rota, ou dois garçons fechando a mesma mesa
  // quase ao mesmo tempo). Sem essa checagem, duas chamadas concorrentes
  // rodariam o pipeline duas vezes e gerariam DOIS documentos autorizados
  // pra mesma venda, cada um com número próprio — o mesmo tipo de problema
  // de compliance que o design de duas fases deste arquivo existe pra
  // evitar, só que chegando por outro ângulo (duplicação de tentativa, não
  // duplicação de reemissão). 'erro'/'rejeitada' ficam de fora de
  // propósito: uma tentativa que falhou antes de qualquer documento existir
  // não deve travar uma nova tentativa. Backstop de banco (índice único
  // parcial) em supabase/migrations/036_fiscal_notas_indice_idempotencia_fix.sql
  // cobre a janela de corrida entre esta checagem e o insert final, que
  // esta query sozinha não fecha.
  //
  // BUG CRÍTICO corrigido em 2026-08-05 (2ª rodada de revisão): a chave de
  // idempotência NÃO pode ser só (store_id, table_id) — `table_id`
  // identifica a MESA física, que é reutilizada o dia inteiro (mesa 5 do
  // almoço não é a mesma venda que a mesa 5 do jantar). A primeira versão
  // deste guard deixava `order_id` sempre `null` no caminho de mesa, então
  // TODA venda futura daquela mesa colidia com a primeira já autorizada —
  // silenciosamente parava de emitir nota pra aquela mesa pro resto da
  // existência dela. Corrigido usando `orderIds[0]` (a primeira `order` da
  // sessão de fechamento, ver `.order('created_at')` acima — precisa ser
  // determinístico) como âncora que identifica a VENDA, não a mesa: dois
  // fechamentos diferentes da mesma mesa sempre têm `orders` novas (UUIDs
  // novos), nunca colidem; o mesmo fechamento (retry) sempre resolve a
  // mesma âncora, e por isso ainda é detectado como duplicata.
  //
  // Só 'autorizada' bloqueia (Task 17, 2026-08-06 — antes também incluía
  // 'pendente'): um documento 'pendente' (ver checagem de destinatário
  // ausente logo abaixo) nunca tocou a SEFAZ, então não existe risco de
  // duplicar nada lá — bloquear nele só impediria pra sempre o fluxo que
  // esta task existe pra viabilizar (lojista preenche o CPF/CNPJ depois e
  // clica "Reemitir", que chama esta mesma rota de novo com o mesmo
  // orderId/tableId). Mesmo tratamento que 'erro'/'rejeitada' já recebiam.
  // Migration 037 aplica o mesmo ajuste no índice único do banco.
  const tableIdParaChecagem = body.tableId ?? null;
  const orderIdParaChecagem = orderIds[0];
  let checagemIdempotencia = admin
    .from('fiscal_notas')
    .select('id')
    .eq('store_id', storeId)
    .eq('order_id', orderIdParaChecagem)
    .eq('status', 'autorizada');
  checagemIdempotencia = tableIdParaChecagem
    ? checagemIdempotencia.eq('table_id', tableIdParaChecagem)
    : checagemIdempotencia.is('table_id', null);
  const { data: notaExistente } = await checagemIdempotencia.maybeSingle();
  if (notaExistente) {
    return NextResponse.json({ skipped: true, reason: 'Nota já existe para esta venda' });
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
    // Sempre populado, mesmo no caminho de mesa (bug corrigido acima, ver
    // comentário na guarda de idempotência) — `orderIds[0]` é a primeira
    // `order` da sessão de fechamento, âncora estável que identifica esta
    // VENDA especificamente, não só a mesa física.
    order_id: orderIds[0],
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

  // Falta destinatário pra NF-e (Task 17) — checado ANTES de qualquer coisa
  // da FASE 1, especificamente antes da numeração (passo 5 logo abaixo):
  // nenhum número fiscal pode ser consumido por uma tentativa que já nasce
  // incompleta. Diferente do erro genérico que `montarXmlNota` lançaria (o
  // que cairia no catch da FASE 1 como 'erro' DEPOIS de já ter gasto um
  // número), aqui a nota grava direto como 'pendente' com um motivo claro —
  // o lojista preenche o documento depois pela aba "Notas Fiscais" e clica
  // "Reemitir" (Task 16), que chama esta mesma rota de novo com o mesmo
  // orderId/tableId. `.trim()` cobre o caso de a UI mandar
  // `destinatario: { cpfCnpj: '', nome: '' }` (campo deixado em branco, não
  // omitido) como equivalente a "sem destinatário".
  if (modelo === '55' && !body.destinatario?.cpfCnpj?.trim()) {
    const { error: insertErr } = await admin.from('fiscal_notas').insert({
      ...notaBase,
      status: 'pendente',
      motivo_erro: 'Falta documento do destinatário para NF-e.',
    });
    if (insertErr) console.error('Emissão fiscal: falha ao gravar fiscal_notas (pendente por falta de destinatário):', insertErr);
    return NextResponse.json({ ok: false, reason: 'Falta documento do destinatário para NF-e.' });
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
        // CNPJ de fallback da própria SEFAZ-BA pro grupo <autXML>, exigência
        // específica da Bahia desde 01/01/2016 (identificação do escritório
        // de contabilidade). Sem NENHUM valor aqui, a SEFAZ rejeita com
        // cStat=486 — já reproduzido e resolvido com este mesmo CNPJ em
        // teste real (AGENTS.md, 2026-08-03/04, autorização cStat=100 tanto
        // em NF-e quanto em NFC-e). Não existe ainda campo em
        // store_fiscal_config pro CNPJ do escritório de contabilidade real
        // da loja (fora de escopo desta task) — usar sempre este fallback
        // até esse campo existir.
        autXmlCnpj: '13937073000156',
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

      // URLs corretas do ambiente (homologação/produção) — antes ficavam
      // hardcoded sempre em homologação (achado de revisão, 2026-08-05):
      // uma nota autorizada em produção teria QR Code funcional (o hash não
      // depende dessas URLs, só do CSC) mas o cupom impresso apontaria pro
      // host de teste. Ver lib/fiscal/soap.ts (resolverEndpointsNfceConsulta).
      const { urlQrCode, urlChave } = resolverEndpointsNfceConsulta(config.ambiente);

      const { supl } = montarQrCode({
        chave,
        tpAmb: config.ambiente === 'homologacao' ? 2 : 1,
        idCsc,
        csc,
        urlQrCode,
        urlChave,
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
