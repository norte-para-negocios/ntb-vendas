import { getOfflineDb } from './db';
import type { QueuedAction, QueuedActionType } from './types';

// crypto.randomUUID() já é usado hoje em outras partes do app rodando em
// navegador/Electron (ambiente seguro, HTTPS ou file://+app://) — mesma
// API, sem polyfill novo.
export async function enqueue(type: QueuedActionType, payload: Record<string, unknown>): Promise<string> {
  const db = await getOfflineDb();
  const action: QueuedAction = {
    id: crypto.randomUUID(),
    type,
    payload,
    createdAt: Date.now(),
    attempts: 0,
  };
  await db.put('queue', action);
  return action.id;
}

// Ordenado por createdAt — a fila SEMPRE sincroniza na ordem em que as
// ações aconteceram (Global Constraint: nunca em paralelo, ver Task 8).
export async function getPendingActions(): Promise<QueuedAction[]> {
  const db = await getOfflineDb();
  return db.getAllFromIndex('queue', 'by-createdAt');
}

export async function markDone(id: string): Promise<void> {
  const db = await getOfflineDb();
  await db.delete('queue', id);
}

export async function markFailed(id: string, error: string): Promise<void> {
  const db = await getOfflineDb();
  const action = await db.get('queue', id);
  if (!action) return;
  action.attempts += 1;
  action.lastError = error;
  await db.put('queue', action);
}

// Fix round 1 da Task 7 (revisão independente, 2026-09-14): uma ação que
// estourou o teto de tentativas era pulada pelo runSync mas NUNCA saía da
// fila — só `markDone` (sucesso) apagava alguma coisa. Depois que o
// operador resolvia o problema por fora (ex.: recebeu o pagamento de novo,
// já online), a ação velha continuava na IndexedDB daquele aparelho pra
// sempre, contando no badge "🔴 N falha(s)". Alarme que não some é alarme
// que ninguém lê — e aí a falha seguinte, de verdade, passa batida. Estas
// três funções são a saída: listar as travadas, reenviar (zerando as
// tentativas) e descartar de vez.
export async function getFailedActions(maxAttempts: number): Promise<QueuedAction[]> {
  const db = await getOfflineDb();
  const all = await db.getAllFromIndex('queue', 'by-createdAt');
  return all.filter((a) => a.attempts >= maxAttempts);
}

// Zera o contador pra ação voltar a ser elegível na próxima drenagem. NÃO
// tenta sincronizar aqui — quem chama decide (ver retryFailedAction em
// sync.ts, que dispara o runSync logo em seguida).
export async function resetActionAttempts(id: string): Promise<void> {
  const db = await getOfflineDb();
  const action = await db.get('queue', id);
  if (!action) return;
  action.attempts = 0;
  action.lastError = undefined;
  await db.put('queue', action);
}

// Apaga uma ação sem executá-la — o efeito dela no servidor NUNCA vai
// acontecer. Só deve ser chamado a partir de uma confirmação explícita que
// diga isso ao operador (ver a lista de falhas em StoreModule.tsx).
export async function discardAction(id: string): Promise<void> {
  const db = await getOfflineDb();
  await db.delete('queue', id);
}

export async function countPending(): Promise<number> {
  const db = await getOfflineDb();
  return db.count('queue');
}
