import { NextRequest, NextResponse, after } from 'next/server';
import { montarPayloadsPorPedido, registrarBaixa, carregarLinha, processarBaixa, type ResumoProcessamento } from '@/lib/baixaEstoqueServidor';

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
// Quem chama (lib/api.ts) continua fire-and-forget e nunca derruba o fechamento
// do pedido, MAS a baixa deixou de depender do navegador: cada pedido vira uma
// linha de outbox (integracao_baixas, migration 156) ANTES de chamar o Estoque,
// o resultado é gravado por item e o job do servidor (lib/baixaEstoqueRetry.ts)
// reenvia o que falhou e varre pedidos que o navegador não registrou.

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { motivoSemBaixa } from '@/lib/modoEstoque';

interface RequestBody {
  orderId?: string;
  tableId?: string;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.orderId && !body?.tableId) {
    return NextResponse.json({ skipped: true, reason: 'orderId ou tableId ausente' });
  }

  const admin = getSupabaseAdmin(request.headers.get('x-ntb-actor'));

  let storeId: string | null = null;
  let orderIds: string[] = [];
  const detalhesPorPedido = new Map<string, Record<string, unknown> | null>();

  if (body.orderId) {
    const { data: order } = await admin
      .from('orders')
      .select('id, store_id, payment_details')
      .eq('id', body.orderId)
      .maybeSingle();
    if (order) {
      storeId = order.store_id;
      orderIds = [order.id];
      detalhesPorPedido.set(order.id, order.payment_details as Record<string, unknown> | null);
    }
  } else if (body.tableId) {
    // Pedidos recém-fechados pela mesa (close_table_orders_secure marca
    // 'delivered' e atualiza updated_at bem antes desta chamada) — a janela
    // de 5 min evita pegar pedidos de uma sessão anterior da mesma mesa.
    const { data: orders } = await admin
      .from('orders')
      .select('id, store_id, payment_details')
      .eq('table_id', body.tableId)
      .eq('status', 'delivered')
      .gte('updated_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
    if (orders?.length) {
      storeId = orders[0].store_id;
      orderIds = orders.map((o) => o.id);
      orders.forEach((o) => detalhesPorPedido.set(o.id, o.payment_details as Record<string, unknown> | null));
    }
  }

  if (!storeId || !orderIds.length) {
    return NextResponse.json({ skipped: true, reason: 'Pedido(s) não encontrado(s)' });
  }

  // Idempotência: a janela de 5 min acima também pega o pedido da venda ANTERIOR da
  // mesa (ex.: mesa vazia finalizada logo depois de uma venda) — sem esta marca, o
  // mesmo pedido gerava Ordem de Produção e baixa de estoque duas vezes.
  const jaEnviados = (id: string) => !!detalhesPorPedido.get(id)?.op_enviada_em;
  const pendentesDeOp = orderIds.filter((id) => !jaEnviados(id));

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

  if (!pendentesDeOp.length) {
    return NextResponse.json({ skipped: true, reason: 'Ordem de produção já enviada para este pedido' });
  }

  // Modo de estoque (migration 168): loja 'nenhum' só vende e emite nota. Nada de baixa, de outbox nem de chamada ao Estoque.
  // (O histórico no Contabo acima continua valendo.) Coluna ausente (banco antigo) = 'omie', como sempre.
  const { data: lojaModo } = await admin.from('stores').select('stock_mode').eq('id', storeId).maybeSingle();
  const semBaixa = motivoSemBaixa(lojaModo?.stock_mode);
  if (semBaixa) return NextResponse.json({ skipped: true, reason: semBaixa });

  const { data: secret } = await admin
    .from('store_ntb_estoque_secrets')
    .select('ntb_estoque_url, ntb_estoque_api_key, ativo')
    .eq('store_id', storeId)
    .maybeSingle();

  if (!secret) {
    return NextResponse.json({ skipped: true, reason: 'Loja sem integração ntb-estoque configurada' });
  }
  if (!secret.ativo) {
    return NextResponse.json({ skipped: true, reason: 'Integração ntb-estoque desativada pela loja' });
  }

  // Outbox (migration 156, auditoria 04/10): cada pedido vira UMA linha em integracao_baixas ANTES de chamar o Estoque; o
  // resultado é gravado POR ITEM e só vira "ok" (e op_enviada_em) quando TODOS os itens deram ok. O que falhar fica visível
  // na Administração e o job do servidor (lib/baixaEstoqueRetry.ts) reenvia só o que está comprovadamente não gravado.
  const pedidosPendentes = pendentesDeOp.map((id) => ({ id, payment_details: detalhesPorPedido.get(id) ?? null }));
  const payloads = await montarPayloadsPorPedido(admin, storeId, pedidosPendentes);

  const baixas: ResumoProcessamento[] = [];
  const ntbEstoque: unknown[] = [];
  let semItens = 0;
  for (const id of pendentesDeOp) {
    const montado = payloads.get(id);
    if (!montado || !montado.payload.itens.length) { semItens++; continue; }
    const reg = await registrarBaixa(admin, storeId, id, montado.rotulo, montado.payload);
    if (!reg.criada) { baixas.push({ id: reg.id, status: reg.status, processada: false, motivo: 'Baixa deste pedido já registrada', enviados: 0 }); continue; }
    const linha = await carregarLinha(admin, reg.id, storeId);
    if (!linha) continue;
    const r = await processarBaixa(admin, linha);
    baixas.push(r);
    ntbEstoque.push({ pedido: id, status: r.status });
  }

  if (!baixas.length && semItens === pendentesDeOp.length) {
    return NextResponse.json({ skipped: true, reason: 'Nenhum item com omie_codigo vinculado' });
  }
  return NextResponse.json({ ok: baixas.length > 0 && baixas.every((b) => b.status === 'ok'), baixas, ntbEstoque });
}
