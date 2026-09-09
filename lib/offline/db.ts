import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { QueuedAction, CachedMenu, CachedTables, CachedCashShift, CachedSession, CachedCashShiftSummary } from './types';

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
}

let dbPromise: Promise<IDBPDatabase<OfflineDbSchema>> | null = null;

// Singleton — todo consumidor (queue.ts, cache.ts) chama isto, nunca abre
// a própria conexão. IndexedDB permite múltiplas conexões simultâneas,
// mas não há motivo pra isso aqui e complica versionamento de schema.
export function getOfflineDb(): Promise<IDBPDatabase<OfflineDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDbSchema>('ntb-vendas-offline', 4, {
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
      },
    });
  }
  return dbPromise;
}
