import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { carregarConfigFiscalDaLoja } from '@/lib/fiscal/carregarCredenciaisFiscaisDaLoja';
import { conferirXmlContingencia, type NotaOffline } from '@/lib/fiscal/emitirOffline';
import { gerarPdfContingencia } from '@/lib/fiscal/pdfContingencia';

// Recebe a NFC-e em contingência que o computador da loja emitiu sem internet (lib/fiscal/emitirOffline.ts),
// quando a internet volta. Grava em fiscal_notas como 'contingencia' (a retransmissão de sempre manda à SEFAZ em
// até 2 min), liga aos itens da venda e atualiza o contador da série do computador. Idempotente pela chave.
// A venda é achada pelo payment_id do pagamento (payment_details.payment_id), nunca por janela de tempo.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { storeId?: string; tableId?: string | null; paymentId?: string; deviceId?: string; nota?: NotaOffline };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const nota = body?.nota;
  const storeId = body?.storeId ?? '';
  if (!UUID_RE.test(storeId) || !body?.paymentId || !nota?.xml || !nota.chave) {
    return NextResponse.json({ ok: false, reason: 'Parâmetros inválidos.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();

  const { data: existente } = await admin.from('fiscal_notas').select('id').eq('store_id', storeId).eq('chave_acesso', nota.chave).maybeSingle();
  if (existente) return NextResponse.json({ ok: true, jaRegistrada: true, notaId: existente.id });

  const config = await carregarConfigFiscalDaLoja(admin, storeId);
  const { data: storeRow } = await admin.from('stores').select('cnpj, name').eq('id', storeId).maybeSingle();
  const cnpj = String(storeRow?.cnpj || '').replace(/\D/g, '');
  if (!config || !cnpj) return NextResponse.json({ ok: false, reason: 'Loja sem configuração fiscal.' }, { status: 422 });
  // Ambiente da NOTA (o do kit quando ela foi feita) tem que ser o atual da loja: se a loja trocou de ambiente no meio,
  // a nota não é aceita aqui e aparece como erro para o gerente.
  const problema = conferirXmlContingencia(nota.xml, { cnpj, ambiente: config.ambiente, chave: nota.chave, serie: Number(nota.serie), numero: Number(nota.numero) });
  if (problema) return NextResponse.json({ ok: false, reason: `Nota sem internet recusada: ${problema}.` }, { status: 422 });

  const { data: orders } = await admin
    .from('orders')
    .select('id, table_id, created_at')
    .eq('store_id', storeId)
    .eq('payment_details->>payment_id', body.paymentId)
    .order('created_at', { ascending: true });
  if (!orders?.length) return NextResponse.json({ ok: false, reason: 'Venda ainda não chegou ao servidor.' }, { status: 409 });
  const orderIds = orders.map((o) => o.id as string);

  let pdfPath: string | null = null;
  try {
    const pdf = await gerarPdfContingencia({
      storeName: storeRow?.name || '',
      cnpj,
      chave: nota.chave,
      dataHora: new Date(nota.dhEmi),
      itens: (nota.itens || []).map((i) => ({ descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, valorTotal: i.valorTotal })),
      valorTotal: Number(nota.valorTotal),
      via: 1,
      qrCode: nota.qrCode,
    });
    const caminho = `${storeId}/${nota.chave}-contingencia.pdf`;
    const up = await admin.storage.from('fiscal-documentos').upload(caminho, pdf, { contentType: 'application/pdf', upsert: true });
    if (!up.error) pdfPath = caminho;
  } catch (e) {
    console.error('registrar-contingencia: PDF não gerado (a nota segue):', e);
  }

  const { data: salva, error: insErr } = await admin
    .from('fiscal_notas')
    .insert({
      store_id: storeId,
      table_id: body.tableId ?? orders[0].table_id ?? null,
      order_id: orderIds[0],
      modelo: '65',
      ambiente: config.ambiente,
      valor_total: Number(nota.valorTotal),
      pessoa_identificador: null,
      status: 'contingencia',
      chave_acesso: nota.chave,
      numero: Number(nota.numero),
      serie: Number(nota.serie),
      xml_contingencia: nota.xml,
      pdf_path: pdfPath,
      motivo_erro: 'Emitida sem internet no computador da loja (contingência). Vai para a SEFAZ automaticamente.',
    })
    .select('id')
    .single();
  if (insErr || !salva) {
    console.error('registrar-contingencia: falha ao gravar fiscal_notas:', insErr);
    return NextResponse.json({ ok: false, reason: 'Falha ao gravar a nota.' }, { status: 500 });
  }

  const { data: itens } = await admin.from('order_items').select('id, status').in('order_id', orderIds).is('fiscal_nota_id', null);
  const ids = (itens ?? []).filter((i) => i.status !== 'canceled').map((i) => i.id as string);
  if (ids.length) {
    const { error } = await admin.from('order_items').update({ fiscal_nota_id: salva.id }).in('id', ids);
    if (error) console.error('registrar-contingencia: falha ao marcar order_items:', error);
  }

  if (body.deviceId) {
    const { data: s } = await admin.from('fiscal_contingencia_series').select('ultimo_numero')
      .eq('store_id', storeId).eq('device_id', body.deviceId).eq('ambiente', config.ambiente).maybeSingle();
    if (s && Number(nota.numero) > (s.ultimo_numero as number)) {
      await admin.from('fiscal_contingencia_series').update({ ultimo_numero: Number(nota.numero), updated_at: new Date().toISOString() })
        .eq('store_id', storeId).eq('device_id', body.deviceId).eq('ambiente', config.ambiente);
    }
  }
  return NextResponse.json({ ok: true, notaId: salva.id });
}
