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

export async function setCachedTables(storeId: string, tables: unknown[], activeOrders: unknown[]): Promise<void> {
  const db = await getOfflineDb();
  await db.put('tables_cache', { storeId, tables, activeOrders, updatedAt: Date.now() });
}

export async function getCachedTables(storeId: string): Promise<CachedTables | undefined> {
  const db = await getOfflineDb();
  return db.get('tables_cache', storeId);
}
