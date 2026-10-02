import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { QueuedAction, CachedMenu, CachedTables, CachedCashShift, CachedSession, CachedCashShiftSummary, CachedKitchenOrders, CachedCounterOrders } from './types';

interface OfflineDbSchema extends DBSchema {
  queue: {
    key: string; // QueuedAction.id
    value: QueuedAction;
    indexes: { 'by-createdAt': number };
  };
  menu_cache: {
    key: string; // storeId
    value: CachedMenu;
  };
  tables_cache: {
    key: string; // storeId
    value: CachedTables;
  };
  cash_shift_cache: {
    key: string; // CachedCashShift.key
    value: CachedCashShift;
  };
  session_cache: {
    key: string; // CachedSession.key
    value: CachedSession;
  };
  cash_shift_summary_cache: {
    key: string; // CachedCashShiftSummary.shiftId
    value: CachedCashShiftSummary;
  };
  kitchen_cache: {
    key: string; // CachedKitchenOrders.key
    value: CachedKitchenOrders;
  };
  counter_cache: {
    key: string; // storeId
    value: CachedCounterOrders;
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDbSchema>> | null = null;

// Versão do app usada pra invalidar caches de leitura (cardápio, mesas, etc.)
// quando o código muda. Bumpar este número força um refresh completo na
// próxima abertura — resolve o caso de dados gravados no banco mudarem
// (ex.: price_delta de variants de pizza) sem o app saber. A fila de ações
// pendentes (queue) NUNCA é limpa por isso — só os caches de leitura.
const CACHE_VERSION = 2; // bumpou em 2026-10-02: pizza meio a meio (variants com preço real)
const CACHE_VERSION_KEY = 'ntb-vendas-cache-version';

async function invalidateReadCachesIfVersionChanged(db: IDBPDatabase<OfflineDbSchema>): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const stored = localStorage.getItem(CACHE_VERSION_KEY);
  if (stored === String(CACHE_VERSION)) return;
  // Limpa todos os object stores de leitura; preserva queue (ações pendentes)
  // e session_cache (login persistido — não queremos forçar re-login).
  const readStores: Array<keyof OfflineDbSchema> = [
    'menu_cache', 'tables_cache', 'cash_shift_cache',
    'cash_shift_summary_cache', 'kitchen_cache', 'counter_cache',
  ];
  const tx = db.transaction(readStores as any[], 'readwrite');
  for (const name of readStores) {
    try { await tx.objectStore(name as any).clear(); } catch { /* store pode não existir em versões antigas */ }
  }
  await tx.done;
  localStorage.setItem(CACHE_VERSION_KEY, String(CACHE_VERSION));
}

// Singleton — todo consumidor (queue.ts, cache.ts) chama isto, nunca abre
// a própria conexão. IndexedDB permite múltiplas conexões simultâneas,
// mas não há motivo pra isso aqui e complica versionamento de schema.
export function getOfflineDb(): Promise<IDBPDatabase<OfflineDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDbSchema>('ntb-vendas-offline', 5, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const queueStore = db.createObjectStore('queue', { keyPath: 'id' });
          queueStore.createIndex('by-createdAt', 'createdAt');
          db.createObjectStore('menu_cache', { keyPath: 'storeId' });
          db.createObjectStore('tables_cache', { keyPath: 'storeId' });
        }
        if (oldVersion < 2) {
          db.createObjectStore('cash_shift_cache', { keyPath: 'key' });
        }
        if (oldVersion < 3) {
          db.createObjectStore('session_cache', { keyPath: 'key' });
        }
        if (oldVersion < 4) {
          db.createObjectStore('cash_shift_summary_cache', { keyPath: 'shiftId' });
        }
        if (oldVersion < 5) {
          db.createObjectStore('kitchen_cache', { keyPath: 'key' });
          db.createObjectStore('counter_cache', { keyPath: 'storeId' });
        }
      },
    }).then(async (db) => {
      await invalidateReadCachesIfVersionChanged(db);
      return db;
    });
  }
  return dbPromise;
}
