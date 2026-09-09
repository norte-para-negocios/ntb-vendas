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
      // C2: `paymentData.cash_shift_id` pode carregar o `local_<uuid>` falso
      // do turno aberto offline (ver case 'open_cash_shift' acima) — resolve
      // via idMap numa CÓPIA de `paymentData`, nunca mutando o payload
      // original da ação (só importa se essa mesma ação for reprocessada,
      // mas é o mesmo cuidado já seguido no resto deste arquivo).
      let paymentData = payload.paymentData;
      if (paymentData?.cash_shift_id) {
        const realShiftId = idMap.get(paymentData.cash_shift_id) ?? paymentData.cash_shift_id;
        paymentData = { ...paymentData, cash_shift_id: realShiftId };
      }
      const { error: closeErr } = await supabase.rpc('close_table_orders_secure', {
        p_table_id: payload.tableId, p_payment_method: payload.paymentMethod, p_payment_details: paymentData,
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
      // C2: mesmo raciocínio do case 'close_table_session' acima.
      let paymentData = payload.paymentData;
      if (paymentData?.cash_shift_id) {
        const realShiftId = idMap.get(paymentData.cash_shift_id) ?? paymentData.cash_shift_id;
        paymentData = { ...paymentData, cash_shift_id: realShiftId };
      }
      if (paymentData) {
        const paymentMethod = paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE';
        const res = await fetch(resolverUrlApi('/api/orders/pagamento-balcao'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: payload.orderId, paymentMethod, paymentDetails: paymentData }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message || 'Falha ao registrar o pagamento do pedido de balcão.');
        }
      }
      // close_counter_order_secure retorna `void` (não `jsonb`, ver
      // supabase/migrations/021_fecha_rls_orders_products.sql) — não tem
      // `data.success` pra checar, então C1 não se aplica a este case
      // (confirmado lendo a migration antes de mexer, ver task-12-report.md).
      const { error } = await supabase.rpc('close_counter_order_secure', { p_order_id: payload.orderId });
      if (error) throw error;
      triggerOrdemProducao({ orderId: payload.orderId });
      triggerEmissaoFiscal({ orderId: payload.orderId, destinatario: payload.destinatario });
      break;
    }
    case 'open_cash_shift': {
      // C1/C2 da revisão final (ver task-12-report.md): `open_cash_shift_secure`
      // recusa com `{success:false, message}` de NEGÓCIO (ex. "você já tem um
      // turno de caixa aberto") sem lançar exception — sem checar `data`, essa
      // recusa era tratada como sucesso (markDone, ação some da fila). Também
      // captura `data` pra resolver o id local (C2): `localShiftId` (adicionado
      // ao payload por `openCashShift` em lib/api.ts) -> `data.id` (id real do
      // turno recém-criado), pra qualquer ação seguinte na mesma sessão de sync
      // que referencie esse turno (register_cash_movement/close_cash_shift/
      // close_table_session/close_counter_order) resolver o id real via idMap
      // em vez de carregar o `local_<uuid>` falso pra sempre.
      const { localShiftId, ...rpcPayload } = action.payload as any;
      const { data, error } = await supabase.rpc('open_cash_shift_secure', rpcPayload);
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Erro ao sincronizar.');
      if (localShiftId && data.id) idMap.set(localShiftId, data.id);
      break;
    }
    case 'close_cash_shift': {
      // Verificado contra closeCashShift (lib/api.ts): o payload enfileirado
      // lá é `{ p_shift_id, p_closing_counted_cash, p_closing_cash_breakdown,
      // p_max_tolerance, p_approved_by_user_id }` — já no formato exato dos
      // parâmetros da RPC `close_cash_shift_secure`, mesmo padrão dos
      // outros casos acima (chamada direta à RPC, nunca via lib/api.ts).
      // C1: agora também valida `data?.success` (mesmo motivo do case
      // 'open_cash_shift' acima — recusa de negócio, ex. diferença de caixa
      // acima da tolerância, não pode virar markDone silencioso). C2: resolve
      // `p_shift_id` via idMap ANTES de montar o payload da RPC, mesmo padrão
      // já usado pro case 'update_order_item_status' com `p_item_id`.
      const payload = action.payload as any;
      const realShiftId = idMap.get(payload.p_shift_id) ?? payload.p_shift_id;
      const { data, error } = await supabase.rpc('close_cash_shift_secure', { ...payload, p_shift_id: realShiftId });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Erro ao sincronizar.');
      break;
    }
    case 'register_cash_movement': {
      // C1 (checa data?.success) + C2 (resolve p_shift_id via idMap), mesmo
      // raciocínio do case 'close_cash_shift' acima.
      const payload = action.payload as any;
      const realShiftId = idMap.get(payload.p_shift_id) ?? payload.p_shift_id;
      const { data, error } = await supabase.rpc('register_cash_movement_secure', { ...payload, p_shift_id: realShiftId });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Erro ao sincronizar.');
      break;
    }
  }
}

let syncing = false;

// C3 da revisão final (2026-09-08, ver task-12-report.md): a trava `syncing`
// era checada ANTES do `await checkRealConnectivity()` (até 4s) e só setada
// `true` DEPOIS desse await — `startOfflineSync()` registra 3 gatilhos
// (evento 'online', poll de 30s, chamada imediata), e dois caindo dentro
// dessa janela de 4s (comum bem no momento da reconexão, que é exatamente
// quando o evento 'online' e o poll tendem a coincidir) processavam a fila
// inteira EM PARALELO — risco real de pedido/pagamento/sangria duplicados.
// Corrigido setando `syncing = true` ANTES do await de conectividade, com um
// único `try/finally` cobrindo a função inteira a partir daí — todo caminho
// de saída (inclusive o early return de "não está online de verdade") agora
// passa por `syncing = false` ao final, então a trava nunca fica presa em
// `true` se `checkRealConnectivity()` ou qualquer passo seguinte lançar.
export async function runSync(): Promise<void> {
  if (syncing) return; // nunca duas sincronizações em paralelo
  syncing = true;
  try {
    const online = await checkRealConnectivity();
    if (!online) {
      const pending = (await getPendingActions()).length;
      notify({ syncing: false, pending, failed: 0 });
      return;
    }

    const idMap = new Map<string, string>();
    const actions = await getPendingActions(); // já vem ordenado por createdAt
    for (const action of actions) {
      // Sequencial de propósito (Global Constraint: nunca em paralelo —
      // evita condição de corrida entre ações da mesma mesa).
      //
      // I1: `MAX_ATTEMPTS` antes não limitava nada de verdade — nada filtrava
      // a fila por tentativas, e esta função reprocessava TODA linha a cada
      // 30s pra sempre, mesmo uma que já tinha estourado o limite. Uma ação
      // que já atingiu `MAX_ATTEMPTS` é pulada (não tenta de novo), mas
      // continua contando como falha pro badge (ver cálculo de `failedCount`
      // abaixo, que agora reflete o total de ações no limite, não só as que
      // falharam NESTA rodada).
      if (action.attempts >= MAX_ATTEMPTS) continue;
      try {
        await processAction(action, idMap);
        await markDone(action.id);
      } catch (e) {
        await markFailed(action.id, (e as Error).message || 'Erro desconhecido');
        // Continua pra próxima ação da fila mesmo com esta falhando —
        // Global Constraint: uma falha nunca trava as ações seguintes.
      }
    }
    const remaining = await getPendingActions();
    const failedCount = remaining.filter((a) => a.attempts >= MAX_ATTEMPTS).length;
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
