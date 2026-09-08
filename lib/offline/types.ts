// Modo offline do app desktop (ver docs/superpowers/specs/2026-09-08-
// modo-offline-app-desktop-design.md). Tipos compartilhados entre
// db.ts/queue.ts/cache.ts/sync.ts.

export type QueuedActionType =
  | 'create_order'
  | 'update_order_item_status'
  | 'close_table_session'
  | 'close_counter_order'
  | 'open_cash_shift'
  | 'close_cash_shift'
  | 'register_cash_movement';

export interface QueuedAction {
  id: string; // uuid gerado no client — idempotency key, e também serve
              // de "ID local temporário" pra ações que criam algo novo
              // (ex.: create_order) antes de existir um ID real do banco.
  type: QueuedActionType;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface CachedMenu {
  storeId: string;
  categories: unknown[]; // Category[] — tipo any de propósito aqui pra
                          // lib/offline/ não depender de @/types e criar
                          // import circular; quem lê já sabe o tipo real.
  products: unknown[]; // Product[]
  updatedAt: number;
}

export interface CachedTables {
  storeId: string;
  tables: unknown[]; // Table[]
  activeOrders: unknown[]; // Order[]
  updatedAt: number;
}
