import { NextRequest, NextResponse, after } from 'next/server';

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

  // Dual-write pro Contabo (historico completo de vendas) -- roda pra
  // QUALQUER loja com pedido resolvido, independente de ter (ou nao)
  // integracao com o ntb-estoque/Omie configurada -- sao duas features
  // independentes, uma nao pode depender da outra (achado real de QA: o
  // bloco original ficava depois do "return" de loja sem integracao, entao
  // so a loja com Ordem de Producao configurada jamais tinha histórico
  // salvo no Contabo). Usa after() (não só "void (async () => {})()") por
  // outro achado real de QA: em produção na Vercel, uma promise disparada
  // sem await e sem vínculo ao lifecycle da function pode ser interrompida
  // assim que a resposta HTTP é enviada — funcionava em `next dev` local
  // (processo Node persistente) mas nunca completava em produção
  // serverless. after() roda depois da resposta ser enviada ao cliente,
  // mas ainda dentro do tempo de vida gerenciado da function (waitUntil).
  if (process.env.NTB_FRIO_API_URL) {
    after(async () => {
      try {
        const [{ data: ordersCompletas }, { data: itemsCompletos }] = await Promise.all([
          admin
            .from('orders')
            .select('id, table_id, store_id, status, order_type, total, customer_name, payment_method, payment_details, created_at, updated_at')
            .in('id', orderIds),
          admin
            .from('order_items')
            .select('id, order_id, product_id, quantity, status, notes, price_at_time, created_at, store_id, selected_options')
            .in('order_id', orderIds),
        ]);
        for (const order of ordersCompletas ?? []) {
          const itensDoPedido = (itemsCompletos ?? []).filter((i) => i.order_id === order.id);
          await fetch(`${process.env.NTB_FRIO_API_URL}/vendas/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.NTB_FRIO_VENDAS_API_KEY! },
            body: JSON.stringify({ order, items: itensDoPedido }),
          });
        }
      } catch (e) {
        console.error('Dual-write de venda pro Contabo falhou:', e);
      }
    });
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
    .select('quantity, status, selected_options, product:products(omie_codigo)')
    .in('order_id', orderIds);

  // Cada adicional/opcional (ex.: borda de pizza) tambem pode ter seu proprio
  // omie_codigo (migration 026) e gera Ordem de Producao própria — snapshot
  // gravado em selected_options pela create_order_secure (migration 028), não
  // precisa de join extra. Pedidos anteriores a essa migration simplesmente
  // não têm o campo (undefined), tratados como sem código.
  const porCodigo = new Map<string, number>();
  for (const item of items ?? []) {
    if (item.status === 'canceled') continue;

    const codigoProduto = (item as any).product?.omie_codigo as string | null | undefined;
    if (codigoProduto) {
      porCodigo.set(codigoProduto, (porCodigo.get(codigoProduto) ?? 0) + item.quantity);
    }

    const opcoes = (item.selected_options ?? []) as { omie_codigo?: string | null }[];
    for (const opcao of opcoes) {
      if (!opcao.omie_codigo) continue;
      porCodigo.set(opcao.omie_codigo, (porCodigo.get(opcao.omie_codigo) ?? 0) + item.quantity);
    }
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
