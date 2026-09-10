import { getPendingActions } from './queue';
import { getCachedMenu } from './cache';

// Achado real (WhatsApp, 2026-09-10, testado ao vivo no app desktop
// empacotado com rede genuinamente bloqueada): a atualização otimista de
// `createOrder` (StoreModule.tsx, `handleAddItem`) vive só no estado React
// de `TablesView` — o pedido continua salvo na fila local (IndexedDB)
// corretamente, mas se o garçom trocar de aba (Cozinha/Balcão) e voltar
// pra "Gestão de Mesas", o componente inteiro remonta, `activeOrders`
// reseta, e `loadData()` reconstrói do zero só a partir do cache/RPC —
// que nunca sabe da ação ainda só na fila. Resultado: o total da comanda
// "volta pra zero" na tela, mesmo com o pedido intacto, reproduzindo a
// mesma confusão de "sumiu" que já foi corrigida pra `openTableManually`
// ontem, só que por um caminho diferente (remontagem, não a própria
// função de refresh).
//
// Fix: reconstrói pedidos sintéticos ainda-só-na-fila (nunca os "perde",
// porque lê da FILA, que é persistida — não do estado React, que não é)
// pra quem monta `activeOrders` mesclar de volta a cada load. Cada ação
// `create_order` pendente vira UM pedido sintético próprio (não tenta
// reaproveitar/fundir com outro pedido pending da mesma mesa como o
// servidor faz de verdade — é só pra exibição; a SOMA do total da mesa
// fica correta de qualquer jeito, já que `getTableSummary` só soma todos
// os `order_items` de todas as orders da mesa).
export async function buildPendingOrdersForStore(storeId: string): Promise<unknown[]> {
  const [actions, cachedMenu] = await Promise.all([getPendingActions(), getCachedMenu(storeId)]);
  const productsById = new Map<string, unknown>(
    ((cachedMenu?.products as { id: string }[]) || []).map((p) => [p.id, p])
  );

  const orders: unknown[] = [];
  for (const action of actions) {
    if (action.type !== 'create_order') continue;
    const payload = action.payload as Record<string, any>;
    if (payload.p_store_id !== storeId) continue;

    const orderId = payload.localOrderId || `pending_order_${action.id}`;
    const items = ((payload.p_items || []) as any[]).map((pItem, idx) => {
      const product = productsById.get(pItem.product_id) as { price?: number } | undefined;
      return {
        id: `pending_item_${action.id}_${idx}`,
        order_id: orderId,
        product_id: pItem.product_id,
        product: product ?? null,
        quantity: pItem.quantity,
        status: 'pending',
        notes: pItem.notes,
        created_at: new Date(action.createdAt).toISOString(),
        // Aproximação de propósito: não recalcula preço promocional/delta
        // de adicional (o payload da fila só tem `option_ids`, não os
        // objetos completos com `price_delta`) — é só exibição enquanto
        // não sincroniza; o valor real e definitivo vem do servidor.
        price_at_time: typeof product?.price === 'number' ? product.price : 0,
        added_by_role: payload.p_added_by_role,
        added_by_name: payload.p_added_by_name,
      };
    });

    orders.push({
      id: orderId,
      table_id: payload.p_table_id,
      store_id: payload.p_store_id,
      status: 'pending',
      order_type: payload.p_order_type,
      total: 0,
      created_at: new Date(action.createdAt).toISOString(),
      customer_name: payload.p_customer_name,
      order_items: items,
    });
  }
  return orders;
}
