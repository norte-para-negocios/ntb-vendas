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

export async function countPending(): Promise<number> {
  const db = await getOfflineDb();
  return db.count('queue');
}
