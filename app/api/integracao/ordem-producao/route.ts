import { NextRequest, NextResponse } from 'next/server';

// Integração ntb-vendas -> ntb-estoque (2026-07-07, ver AGENTS.md e a memória
// "integracao_ntb_vendas_estoque_omie"): dispara Ordem de Produção automática
// no ntb-estoque quando uma venda é concluída (balcão ou mesa).
//
// Roda aqui (service role), não em lib/api.ts, pelos mesmos dois motivos de
// /api/certificado: (1) a chave do ntb-estoque fica em
// store_ntb_estoque_secrets, sem NENHUMA policy de select — só service role
// lê; (2) orders/order_items também não têm mais select público pra anon
// desde a correção de segurança de 021/022, então o browser não conseguiria
// montar a lista de itens sozinho mesmo se quisesse.
//
// Fire-and-forget por design: nunca deve derrubar o fechamento do pedido no
// ntb-vendas. Qualquer falha (loja sem integração, ntb-estoque fora do ar,
// produto sem "estrutura" no Omie) retorna 200 com o motivo — quem chama essa
// rota (lib/api.ts) ignora o resultado.

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

interface RequestBody {
  orderId?: string;
  tableId?: string;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.orderId && !body?.tableId) {
    return NextResponse.json({ skipped: true, reason: 'orderId ou tableId ausente' });
  }

  const admin = getSupabaseAdmin();

  let storeId: string | null = null;
  let orderIds: string[] = [];

  if (body.orderId) {
    const { data: order } = await admin
      .from('orders')
      .select('id, store_id')
      .eq('id', body.orderId)
      .maybeSingle();
    if (order) {
      storeId = order.store_id;
      orderIds = [order.id];
    }
  } else if (body.tableId) {
    // Pedidos recém-fechados pela mesa (close_table_orders_secure marca
    // 'delivered' e atualiza updated_at bem antes desta chamada) — a janela
    // de 5 min evita pegar pedidos de uma sessão anterior da mesma mesa.
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

  const { data: secret } = await admin
    .from('store_ntb_estoque_secrets')
    .select('ntb_estoque_url, ntb_estoque_api_key')
    .eq('store_id', storeId)
    .maybeSingle();

  if (!secret) {
    return NextResponse.json({ skipped: true, reason: 'Loja sem integração ntb-estoque configurada' });
  }

  const { data: items } = await admin
    .from('order_items')
    .select('quantity, status, product:products(omie_codigo)')
    .in('order_id', orderIds);

  const porCodigo = new Map<string, number>();
  for (const item of items ?? []) {
    const codigo = (item as any).product?.omie_codigo as string | null | undefined;
    if (!codigo || item.status === 'canceled') continue;
    porCodigo.set(codigo, (porCodigo.get(codigo) ?? 0) + item.quantity);
  }

  if (!porCodigo.size) {
    return NextResponse.json({ skipped: true, reason: 'Nenhum item com omie_codigo vinculado' });
  }

  const itens = Array.from(porCodigo, ([codigo, quantidade]) => ({ codigo, quantidade }));

  try {
    const res = await fetch(`${secret.ntb_estoque_url.replace(/\/$/, '')}/api/integracao/ordem-producao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret.ntb_estoque_api_key}` },
      body: JSON.stringify({ itens, pedidoRef: orderIds[0] }),
    });
    const json = await res.json().catch(() => null);
    return NextResponse.json({ ok: res.ok, ntbEstoque: json });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : 'Falha ao chamar ntb-estoque' });
  }
}
