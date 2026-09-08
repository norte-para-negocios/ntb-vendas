import { getOfflineDb } from './db';
import type { CachedMenu, CachedTables } from './types';

export async function setCachedMenu(storeId: string, categories: unknown[], products: unknown[]): Promise<void> {
  const db = await getOfflineDb();
  await db.put('menu_cache', { storeId, categories, products, updatedAt: Date.now() });
}

export async function getCachedMenu(storeId: string): Promise<CachedMenu | undefined> {
  const db = await getOfflineDb();
  return db.get('menu_cache', storeId);
}

// `fetchTables` e `fetchActiveOrdersForTables` (lib/api.ts) são chamadas
// SEMPRE em paralelo via Promise.all (StoreModule.tsx loadQueue,
// StoreDashboardView.tsx) e cada uma só conhece a própria fatia
// (tables/activeOrders) do mesmo registro `tables_cache` por loja. Um
// read-then-write feito em duas chamadas separadas (ex.: getCachedTables
// seguido de um setCachedTables monolítico) tem uma corrida real: as duas
// leem o valor antigo antes de qualquer uma escrever, e a segunda escrita
// sobrescreve a primeira com o dado que ela leu, perdendo a fatia recém-
// gravada (achado em review, ver commit da correção). Por isso o
// read-merge-write mora AQUI DENTRO, numa única transação IndexedDB
// (`db.transaction(...)`) — o `get` e o `put` seguintes ficam na mesma
// transação sem nenhum `await` externo entre eles, então o IndexedDB não
// intercala a transação concorrente da outra chamada no meio: ela só
// começa depois que esta transação já comitou (ou vice-versa), nunca as
// duas lendo o mesmo estado "antigo" ao mesmo tempo. `updates` só carrega
// a fatia que o caller possui; a fatia que ele não tem preserva o valor
// já gravado (ou `[]` na primeira escrita).
export async function setCachedTables(
  storeId: string,
  updates: { tables?: unknown[]; activeOrders?: unknown[] }
): Promise<void> {
  const db = await getOfflineDb();
  const tx = db.transaction('tables_cache', 'readwrite');
  const store = tx.objectStore('tables_cache');
  const existing = await store.get(storeId);
  const merged: CachedTables = {
    storeId,
    tables: updates.tables ?? existing?.tables ?? [],
    activeOrders: updates.activeOrders ?? existing?.activeOrders ?? [],
    updatedAt: Date.now(),
  };
  await store.put(merged);
  await tx.done;
}

export async function getCachedTables(storeId: string): Promise<CachedTables | undefined> {
  const db = await getOfflineDb();
  return db.get('tables_cache', storeId);
}
