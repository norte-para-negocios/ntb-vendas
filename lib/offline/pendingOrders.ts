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

// Sem internet a tela de mesas vem da cópia guardada no aparelho, que não sabe do que ainda está na fila (08/10/2026:
// mesa aberta e com pedido sem internet voltava a aparecer "Livre"). Aplica a fila por cima, na ordem em que foi feita:
// abrir mesa -> ocupada; pedido numa mesa livre -> ocupada; fechar a conta -> livre.
type MesaLike = { id: string; status?: string; current_host_name?: string | null; funcionario?: string | null; service_fee_removed?: boolean };
type AcaoLike = { type: string; payload: unknown };
export function aplicarFilaNasMesas<T extends MesaLike>(mesas: T[], acoes: AcaoLike[]): T[] {
  const porId = new Map(mesas.map((m) => [m.id, { ...m }]));
  for (const a of acoes) {
    const p = (a.payload ?? {}) as Record<string, any>;
    if (a.type === 'open_table_manually') {
      const m = porId.get(p.p_table_id);
      if (m) { m.status = 'occupied'; m.current_host_name = p.p_host_name ?? m.current_host_name; if (p.p_funcionario) { m.funcionario = p.p_funcionario; m.service_fee_removed = true; } }
    } else if (a.type === 'create_order' && p.p_table_id) {
      const m = porId.get(p.p_table_id);
      if (m && (m.status === 'available' || !m.status)) m.status = 'occupied';
    } else if (a.type === 'close_table_session') {
      const m = porId.get(p.tableId);
      if (m) { m.status = 'available'; m.current_host_name = null; m.funcionario = null; }
    }
  }
  return mesas.map((m) => porId.get(m.id) as T);
}

export async function mesasComFila<T extends MesaLike>(mesas: T[]): Promise<T[]> {
  try { return aplicarFilaNasMesas(mesas, await getPendingActions()); } catch { return mesas; }
}
