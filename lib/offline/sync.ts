import { getPendingActions, markDone, markFailed } from './queue';
import { checkRealConnectivity } from './network';
import type { QueuedAction } from './types';
import { supabase } from '../supabaseClient';
import { resolverUrlApi, triggerOrdemProducao, triggerEmissaoFiscal } from '../api';

const MAX_ATTEMPTS = 3;

type SyncStatus = { syncing: boolean; pending: number; failed: number };
let currentStatus: SyncStatus = { syncing: false, pending: 0, failed: 0 };
const listeners = new Set<(s: SyncStatus) => void>();

export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

export function onSyncStatusChange(cb: (s: SyncStatus) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(status: SyncStatus) {
  currentStatus = status;
  listeners.forEach((cb) => cb(status));
}

// Mapa local_id -> id real do banco, válido só durante uma sessão de
// sincronização (ver Global Constraint do spec: IDs locais temporários
// de create_order precisam ser resolvidos antes de qualquer ação
// seguinte que dependa deles, ex. update_order_item_status de um item
// desse pedido). Lança (não engole) qualquer erro — quem chama
// (runSync) decide markDone/markFailed.
async function processAction(action: QueuedAction, idMap: Map<string, string>): Promise<void> {
  switch (action.type) {
    case 'create_order': {
      // payload já está no formato de RPC (Task 4 monta rpcPayload e
      // enfileira ele mais localOrderId) — chama a RPC direto, sem
      // reconstruir CartItem[].
      const { localOrderId, ...rpcPayload } = action.payload as any;
      const { data, error } = await supabase.rpc('create_order_secure', rpcPayload);
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Erro ao criar pedido.');
      if (localOrderId && data.order_id) idMap.set(localOrderId, data.order_id);
      break;
    }
    case 'update_order_item_status': {
      const payload = action.payload as any;
      const realItemId = idMap.get(payload.p_item_id) ?? payload.p_item_id;
      const { error } = await supabase.rpc('update_order_item_status_secure', { p_item_id: realItemId, p_status: payload.p_status });
      if (error) throw error;
      break;
    }
    case 'close_table_session': {
      const payload = action.payload as any;
      const { error: closeErr } = await supabase.rpc('close_table_orders_secure', {
        p_table_id: payload.tableId, p_payment_method: payload.paymentMethod, p_payment_details: payload.paymentData,
      });
      if (closeErr) throw closeErr;
      const { error: finalizeErr } = await supabase.rpc('finalize_table_secure', { p_table_id: payload.tableId });
      if (finalizeErr) throw finalizeErr;
      triggerOrdemProducao({ tableId: payload.tableId });
      triggerEmissaoFiscal({ tableId: payload.tableId, destinatario: payload.destinatario });
      break;
    }
    case 'close_counter_order': {
      const payload = action.payload as any;
      if (payload.paymentData) {
        const paymentMethod = payload.paymentData.methods.length === 1 ? payload.paymentData.methods[0].method : 'MULTIPLE';
        const res = await fetch(resolverUrlApi('/api/orders/pagamento-balcao'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: payload.orderId, paymentMethod, paymentDetails: payload.paymentData }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message || 'Falha ao registrar o pagamento do pedido de balcão.');
        }
      }
      const { error } = await supabase.rpc('close_counter_order_secure', { p_order_id: payload.orderId });
      if (error) throw error;
      triggerOrdemProducao({ orderId: payload.orderId });
      triggerEmissaoFiscal({ orderId: payload.orderId, destinatario: payload.destinatario });
      break;
    }
    case 'open_cash_shift': {
      const payload = action.payload as any;
      const { error } = await supabase.rpc('open_cash_shift_secure', payload);
      if (error) throw error;
      break;
    }
    case 'close_cash_shift': {
      // Verificado contra closeCashShift (lib/api.ts): o payload enfileirado
      // lá é `{ p_shift_id, p_closing_counted_cash, p_closing_cash_breakdown,
      // p_max_tolerance, p_approved_by_user_id }` — já no formato exato dos
      // parâmetros da RPC `close_cash_shift_secure`, mesmo padrão dos
      // outros casos acima (chamada direta à RPC, nunca via lib/api.ts).
      const payload = action.payload as any;
      const { error } = await supabase.rpc('close_cash_shift_secure', payload);
      if (error) throw error;
      break;
    }
    case 'register_cash_movement': {
      const payload = action.payload as any;
      const { error } = await supabase.rpc('register_cash_movement_secure', payload);
      if (error) throw error;
      break;
    }
  }
}

let syncing = false;

export async function runSync(): Promise<void> {
  if (syncing) return; // nunca duas sincronizações em paralelo
  const online = await checkRealConnectivity();
  if (!online) {
    const pending = (await getPendingActions()).length;
    notify({ syncing: false, pending, failed: 0 });
    return;
  }

  syncing = true;
  const idMap = new Map<string, string>();
  try {
    const actions = await getPendingActions(); // já vem ordenado por createdAt
    let failedCount = 0;
    for (const action of actions) {
      // Sequencial de propósito (Global Constraint: nunca em paralelo —
      // evita condição de corrida entre ações da mesma mesa).
      try {
        await processAction(action, idMap);
        await markDone(action.id);
      } catch (e) {
        await markFailed(action.id, (e as Error).message || 'Erro desconhecido');
        if (action.attempts + 1 >= MAX_ATTEMPTS) failedCount += 1;
        // Continua pra próxima ação da fila mesmo com esta falhando —
        // Global Constraint: uma falha nunca trava as ações seguintes.
      }
    }
    const remaining = await getPendingActions();
    notify({ syncing: false, pending: remaining.length, failed: failedCount });
  } finally {
    syncing = false;
  }
}

let started = false;

// Chamado uma vez (StoreLayout, Step 3 abaixo). Escuta o evento 'online'
// do navegador E faz polling leve — 'online' sozinho não cobre o caso de
// "conectado mas sem internet de verdade" (ver checkRealConnectivity).
export function startOfflineSync(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => { runSync(); });
  setInterval(() => { runSync(); }, 30000);
  runSync(); // roda uma vez já no início, caso já existam ações pendentes de uma sessão anterior
}
