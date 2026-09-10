import { getOfflineDb } from './db';
import type { CachedMenu, CachedTables, CachedCashShift, CachedSession, CachedCashShiftSummary, CachedKitchenOrders, CachedCounterOrders } from './types';

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

function cashShiftCacheKey(storeId: string, operatorUserId: string | null): string {
  return `${storeId}::${operatorUserId ?? 'universal'}`;
}

export async function setCachedCashShift(storeId: string, operatorUserId: string | null, shift: unknown | null): Promise<void> {
  const db = await getOfflineDb();
  await db.put('cash_shift_cache', { key: cashShiftCacheKey(storeId, operatorUserId), shift, updatedAt: Date.now() });
}

// `undefined` = nunca cacheado nada pra essa loja/operador (estado
// desconhecido — quem chama decide o que fazer). `null` dentro do valor
// (`.shift`) = já confirmamos (online, alguma vez) que não há turno
// aberto. Distinção importante: não confundir "nunca perguntamos" com
// "perguntamos e a resposta foi não".
export async function getCachedCashShift(storeId: string, operatorUserId: string | null): Promise<CachedCashShift | undefined> {
  const db = await getOfflineDb();
  return db.get('cash_shift_cache', cashShiftCacheKey(storeId, operatorUserId));
}

// C4 da revisão final (ver task-12-report.md): fallback de restauração de
// sessão no boot do app — mesmo padrão de setCachedCashShift/getCachedCashShift
// acima, genérico o bastante pra guardar StoreUser+Store, UniversalUser ou
// Store isolada sob uma chave própria por entidade (ver fetchStoreUserById/
// fetchUniversalUserById/fetchStoreById em lib/api.ts).
export async function setCachedSession(key: string, value: unknown): Promise<void> {
  const db = await getOfflineDb();
  await db.put('session_cache', { key, value, updatedAt: Date.now() });
}

export async function getCachedSession(key: string): Promise<CachedSession | undefined> {
  const db = await getOfflineDb();
  return db.get('session_cache', key);
}

// Task 13 — cache de fallback pra fetchCashShiftSummary (lib/api.ts). Mesmo
// motivo do resto: se o operador já tinha aberto o modal "Fechar Caixa"
// enquanto online, o resumo real (desatualizado, mas melhor que nada) fica
// disponível offline. Um turno aberto direto offline nunca terá cache aqui
// (nunca existiu leitura online) — esse caso é resolvido separadamente na UI
// (StoreModule.tsx), não aqui.
export async function setCachedCashShiftSummary(shiftId: string, summary: unknown): Promise<void> {
  const db = await getOfflineDb();
  await db.put('cash_shift_summary_cache', { shiftId, summary, updatedAt: Date.now() });
}

export async function getCachedCashShiftSummary(shiftId: string): Promise<CachedCashShiftSummary | undefined> {
  const db = await getOfflineDb();
  return db.get('cash_shift_summary_cache', shiftId);
}

// Fix round de acompanhamento (2026-09-09) — cache de leitura pra
// fetchKitchenOrders/fetchCounterOrders (lib/api.ts), mesmo padrão de
// setCachedTables/getCachedTables acima. kitchen e bar são caches
// separados (chave composta), já que são fetches independentes.
function kitchenCacheKey(storeId: string, destination: 'kitchen' | 'bar'): string {
  return `${storeId}::${destination}`;
}

export async function setCachedKitchenOrders(storeId: string, destination: 'kitchen' | 'bar', items: unknown[]): Promise<void> {
  const db = await getOfflineDb();
  await db.put('kitchen_cache', { key: kitchenCacheKey(storeId, destination), items, updatedAt: Date.now() });
}

export async function getCachedKitchenOrders(storeId: string, destination: 'kitchen' | 'bar'): Promise<CachedKitchenOrders | undefined> {
  const db = await getOfflineDb();
  return db.get('kitchen_cache', kitchenCacheKey(storeId, destination));
}

export async function setCachedCounterOrders(storeId: string, orders: unknown[]): Promise<void> {
  const db = await getOfflineDb();
  await db.put('counter_cache', { storeId, orders, updatedAt: Date.now() });
}

export async function getCachedCounterOrders(storeId: string): Promise<CachedCounterOrders | undefined> {
  const db = await getOfflineDb();
  return db.get('counter_cache', storeId);
}
