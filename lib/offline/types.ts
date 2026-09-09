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

export interface CachedCashShift {
  key: string; // `${storeId}::${operatorUserId ?? 'universal'}`
  shift: unknown | null; // CashShift | null — null = confirmado "sem turno aberto"
  updatedAt: number;
}

// Cache genérico de fallback pra restauração de sessão no boot do app (C4 da
// revisão final, ver task-12-report.md) — StoreUser+Store, UniversalUser ou
// Store isolada, uma chave por entidade (ex. `store_user:<userId>`,
// `universal_user:<userId>`, `store:<storeId>`). `value` é `unknown` de
// propósito, mesmo motivo de CachedMenu/CachedTables acima (evitar import
// circular com @/types).
export interface CachedSession {
  key: string;
  value: unknown;
  updatedAt: number;
}
