# Modo Offline do App Desktop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App desktop funciona de ponta a ponta sem internet (login já
feito, cardápio, mesas, lançar pedido, KDS, fechar conta, caixa) e
sincroniza sozinho quando a conexão volta — sem lógica de negócio nova
no banco.

**Architecture:** Camada nova `lib/offline/` (IndexedDB via `idb` +
fila de ações pendentes) interceptando as funções de leitura/escrita já
existentes em `lib/api.ts`. Online → comportamento idêntico a hoje.
Offline (ou falha de rede real) → grava local otimisticamente + enfileira
a ação real pra quando a conexão voltar.

**Tech Stack:** `idb` (wrapper leve de IndexedDB, sem dependência
nativa), TypeScript, reaproveitamento total das RPCs Postgres já
existentes.

**Spec:** `docs/superpowers/specs/2026-09-08-modo-offline-app-desktop-design.md`

## Global Constraints

- Nenhuma RPC nova, nenhuma migration — toda ação enfileirada chama
  exatamente a mesma função de `lib/api.ts` (e por baixo, a mesma RPC)
  que já existe hoje.
- Um erro de REDE (`TypeError: Failed to fetch`, timeout, DNS) entra no
  caminho offline. Um erro de NEGÓCIO (RPC respondeu mas com
  `{success: false}`, ou um erro Postgres de verdade tipo violação de
  constraint) **nunca** é enfileirado — precisa continuar subindo/
  aparecendo pro usuário igual hoje. Confundir os dois faria a fila
  "engolir" erros reais de validação.
- `navigator.onLine` sozinho NUNCA decide se uma ação vai online ou
  offline — só decide se vale a pena TENTAR a chamada de rede primeiro.
  A fonte de verdade real é se a chamada de fato falhou por rede.
- Emissão fiscal (`triggerEmissaoFiscal`)/Ordem de Produção
  (`triggerOrdemProducao`) continuam fire-and-forget, chamadas só
  quando a ação de fechamento realmente sincroniza (online de verdade),
  nunca no momento do clique offline.
- Sem suíte de testes automatizada neste projeto — verificação é sempre
  manual, ao vivo, na loja "ZZ Laboratorio (NAO E CLIENTE)".

---

## Task 1: Fundação — IndexedDB, cache e fila de ações

**Files:**
- Modify: `package.json` (adiciona dependência `idb`)
- Create: `lib/offline/types.ts`
- Create: `lib/offline/db.ts`
- Create: `lib/offline/queue.ts`
- Create: `lib/offline/cache.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `openOfflineDb()`, `QueuedAction` (tipo), `enqueue()`,
  `getPendingActions()`, `markDone()`, `markFailed()`, `countPending()`,
  `getCachedMenu()`/`setCachedMenu()`/`getCachedTables()`/
  `setCachedTables()` — consumidos pelas Tasks 2-8.

- [ ] **Step 1: Instalar a dependência**

```bash
npm install idb
```

- [ ] **Step 2: Criar `lib/offline/types.ts`**

```ts
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
```

- [ ] **Step 3: Criar `lib/offline/db.ts`**

```ts
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { QueuedAction, CachedMenu, CachedTables } from './types';

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
}

let dbPromise: Promise<IDBPDatabase<OfflineDbSchema>> | null = null;

// Singleton — todo consumidor (queue.ts, cache.ts) chama isto, nunca abre
// a própria conexão. IndexedDB permite múltiplas conexões simultâneas,
// mas não há motivo pra isso aqui e complica versionamento de schema.
export function getOfflineDb(): Promise<IDBPDatabase<OfflineDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDbSchema>('ntb-vendas-offline', 1, {
      upgrade(db) {
        const queueStore = db.createObjectStore('queue', { keyPath: 'id' });
        queueStore.createIndex('by-createdAt', 'createdAt');
        db.createObjectStore('menu_cache', { keyPath: 'storeId' });
        db.createObjectStore('tables_cache', { keyPath: 'storeId' });
      },
    });
  }
  return dbPromise;
}
```

- [ ] **Step 4: Criar `lib/offline/queue.ts`**

```ts
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
```

- [ ] **Step 5: Criar `lib/offline/cache.ts`**

```ts
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
```

- [ ] **Step 6: Verificar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/offline/types.ts lib/offline/db.ts lib/offline/queue.ts lib/offline/cache.ts
git commit -m "feat(offline): fundação — IndexedDB, cache de leitura e fila de ações pendentes"
```

---

## Task 2: Classificador de erro de rede + verificação ativa de conexão

**Files:**
- Create: `lib/offline/network.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `isNetworkError(error: unknown): boolean`,
  `checkRealConnectivity(): Promise<boolean>` — consumidos pela Task 4-7
  (wrapper de escrita) e Task 8 (sync engine).

- [ ] **Step 1: Criar `lib/offline/network.ts`**

```ts
// Global Constraint do plano: `navigator.onLine` sozinho NUNCA decide se
// uma ação é offline — só decide se vale tentar a chamada de rede
// primeiro. Um erro de RESPOSTA da RPC (ex. {success:false} de negócio,
// ou um erro Postgres real tipo violação de constraint) nunca deve ser
// classificado como erro de rede, senão a fila "engoliria" erros de
// validação de verdade.
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return true;
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) return true;
  // supabase-js (PostgrestError) e o client do Supabase Realtime lançam
  // erros com `message` contendo "Failed to fetch"/"NetworkError" quando
  // a causa real é rede, mesmo não sendo um TypeError nativo — checagem
  // por mensagem como fallback, não como caminho principal.
  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    return /failed to fetch|network ?error|err_internet_disconnected|err_name_not_resolved/i.test((error as any).message);
  }
  return false;
}

// `navigator.onLine` fica `true` em Wi-Fi conectado sem internet de
// verdade (ex. portal cativo, roteador sem link externo) — não confiável
// sozinho (ver comentário da função acima). Esta função faz uma chamada
// real, leve, contra o próprio servidor de produção pra confirmar.
export async function checkRealConnectivity(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    // HEAD na raiz do domínio de produção — não precisa de autenticação,
    // só confirma que o servidor responde. Mesmo domínio já usado por
    // resolverUrlApi() (ver lib/api.ts).
    const res = await fetch('https://testvendase.norteparanegocios.com.br/', {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Verificar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/offline/network.ts
git commit -m "feat(offline): classificador de erro de rede + verificação ativa de conectividade"
```

---

## Task 3: Cache de leitura (cardápio e mesas)

**Files:**
- Modify: `lib/api.ts` (funções `fetchMenu` e `fetchTables`/
  `fetchActiveOrdersForTables`)

**Interfaces:**
- Consumes: `getCachedMenu`/`setCachedMenu`/`getCachedTables`/
  `setCachedTables` (Task 1).
- Produces: nada consumido por outra task — leitura é uma folha da
  árvore de dependências deste plano.

- [ ] **Step 1: Localizar `fetchMenu` em `lib/api.ts`**

```bash
grep -n "^export const fetchMenu" lib/api.ts
```

- [ ] **Step 2: Envolver `fetchMenu` com cache de leitura**

Ler a função completa primeiro (`fetchMenu`, por volta da linha 374) —
ela já tem um formato de retorno `{ categories, products, error? }`. A
mudança: quando a query ao Supabase falhar (catch existente ou
`error` já tratado hoje), em vez de devolver listas vazias/erro,
tentar o cache primeiro:

```ts
// No catch/ramo de erro que já existe em fetchMenu, antes de devolver
// `{ categories: [], products: [], error: 'network' }`:
const cached = await getCachedMenu(storeId);
if (cached) {
  return { categories: cached.categories as Category[], products: cached.products as Product[] };
}
// se não há cache nenhum (primeira vez, nunca carregou online), mantém o
// comportamento de erro que já existe hoje.
```

E no caminho de SUCESSO da função (antes do `return` feliz), adicionar:

```ts
setCachedMenu(storeId, categories, products).catch(() => {}); // fire-and-forget, nunca atrasa a resposta
```

Import novo no topo do arquivo: `import { getCachedMenu, setCachedMenu, getCachedTables, setCachedTables } from './offline/cache';`

- [ ] **Step 3: Mesmo padrão em `fetchTables`/`fetchActiveOrdersForTables`**

Aplicar a mesma lógica (salvar no sucesso, ler do cache na falha) nas
duas funções — usando `getCachedTables`/`setCachedTables` (que guardam
`tables` e `activeOrders` juntos, ver Task 1 Step 5). Como são duas
funções separadas hoje que alimentam o mesmo cache, cada uma faz um
"merge" simples: lê o cache existente, atualiza só o campo que lhe diz
respeito (`tables` ou `activeOrders`), grava de volta.

- [ ] **Step 4: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Verificação ao vivo**

Rodar o app desktop, logar, deixar carregar Cardápio e Mesas
normalmente (online). Abrir as DevTools do Electron (Ctrl+Shift+I) →
Network → marcar "Offline". Recarregar a página (F5 dentro do app, ou
navegar entre abas) — confirmar que Cardápio e Mesas continuam
mostrando os dados de antes, em vez de tela vazia/erro.

- [ ] **Step 6: Commit**

```bash
git add lib/api.ts
git commit -m "feat(offline): cardápio e mesas caem pro cache local quando a rede falha"
```

---

## Task 4: Lançar pedido offline (createOrder)

**Files:**
- Modify: `lib/api.ts` (`createOrder`)

**Interfaces:**
- Consumes: `enqueue`, `isNetworkError`, `getCachedTables`/
  `setCachedTables` (Tasks 1-2).
- Produces: o padrão de wrapper aqui é o MODELO pras Tasks 5-7 (mesmo
  formato de try/catch + enqueue + atualização otimista).

**Nota de prioridade**: esta é a ação que motivou o pedido (Ramon:
"tentei abrir uma mesa e lançar pedido sem internet, não funcionou") —
a mais importante de todo o plano.

- [ ] **Step 1: Ler `createOrder` completa (linha ~994 de `lib/api.ts`)**

- [ ] **Step 2: Envolver a chamada RPC em try/catch classificando o erro**

```ts
export const createOrder = async (
  tableId: string | null,
  storeId: string,
  items: CartItem[],
  customerName?: string,
  addedByRole: 'cliente' | 'garcom' = 'cliente',
  addedByName?: string,
): Promise<{ success: boolean; orderId?: string }> => {
  const isCounter = tableId === null;
  const pItems = items.map((item) => ({
    product_id: item.product.id,
    quantity: item.quantity,
    notes: item.notes
      ? `${customerName ? `[${customerName}] ` : ''}${item.notes}`
      : customerName
      ? `[${customerName}]`
      : '',
    option_ids: (item.selectedOptions || []).map(o => o.option_id),
  }));

  const rpcPayload = {
    p_table_id: tableId,
    p_store_id: storeId,
    p_order_type: isCounter ? 'counter' : 'table',
    p_customer_name: customerName || null,
    p_items: pItems,
    p_added_by_role: addedByRole,
    p_added_by_name: addedByName || null,
  };

  try {
    const { data, error } = await supabase.rpc('create_order_secure', rpcPayload);
    if (error) throw error;
    if (!data?.success) throw new Error(data?.message || 'Erro ao criar pedido.');
    return { success: true, orderId: data.order_id };
  } catch (error) {
    if (!isNetworkError(error)) {
      // Erro de NEGÓCIO (ex. mesa com PIN errado, item indisponível) —
      // nunca enfileira, sobe normal igual sempre subiu.
      console.error('Create Order Error', error);
      throw error;
    }
    // Erro de REDE — cai no caminho offline.
    const localOrderId = `local_${crypto.randomUUID()}`;
    await enqueue('create_order', { ...rpcPayload, localOrderId });
    // Atualização otimista: soma o pedido novo ao cache local de mesas,
    // pra a tela refletir a mudança na hora (mesmo princípio de update
    // otimista já usado em KdsView.advanceStatus, ver StoreModule.tsx).
    // Detalhe exato do merge fica a critério do implementador — a
    // estrutura mínima que a UI precisa pra mostrar "1 pedido pendente"
    // na mesa é o suficiente aqui, não precisa espelhar 100% o formato
    // de Order/OrderItem que o servidor devolveria.
    return { success: true, orderId: localOrderId };
  }
};
```

Import novo: `import { enqueue } from './offline/queue'; import { isNetworkError } from './offline/network';`

- [ ] **Step 3: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Verificação ao vivo (o teste mais importante deste plano)**

App desktop, DevTools → Network → Offline. Lançar um pedido numa mesa
de teste (ZZ Laboratorio). Confirmar: (a) a tela mostra o pedido
imediatamente, sem erro; (b) o ticket de cozinha imprime normalmente
(impressão não depende de rede, ver spec); (c) abrir IndexedDB nas
DevTools (Application → IndexedDB → ntb-vendas-offline → queue) e
confirmar que existe uma entrada com `type: 'create_order'`.

- [ ] **Step 5: Commit**

```bash
git add lib/api.ts
git commit -m "feat(offline): lançar pedido funciona sem internet (create_order enfileira e sincroniza depois)"
```

---

## Task 5: Avançar status do KDS offline (updateOrderItemStatus)

**Files:**
- Modify: `lib/api.ts` (`updateOrderItemStatus`)

**Interfaces:**
- Consumes: mesmo padrão da Task 4.
- Produces: nada novo — segue o modelo já estabelecido.

- [ ] **Step 1: Aplicar o mesmo padrão de try/catch + enqueue da Task 4**

```ts
export const updateOrderItemStatus = async (itemId: string, status: OrderStatus): Promise<{ success: boolean; message?: string }> => {
  try {
    const { error } = await supabase.rpc('update_order_item_status_secure', { p_item_id: itemId, p_status: status });
    if (error) throw error;
    return { success: true };
  } catch (error) {
    if (!isNetworkError(error)) {
      console.error('Update Order Item Status Error:', error);
      return { success: false, message: (error as Error).message };
    }
    await enqueue('update_order_item_status', { p_item_id: itemId, p_status: status });
    return { success: true };
  }
};
```

(nota: a função original já devolve `{success, message}` em vez de
lançar — mantém esse formato, só troca o `error` do bloco atual por
try/catch com a checagem de rede.)

- [ ] **Step 2: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 3: Verificação ao vivo**

Offline, avançar um item no KDS (Cozinha ou Bar) de "Pendente" pra "Em
Preparo". Confirmar que o card muda de coluna/status na tela
imediatamente, e que a fila (IndexedDB → queue) ganhou uma entrada
`update_order_item_status`.

- [ ] **Step 4: Commit**

```bash
git add lib/api.ts
git commit -m "feat(offline): avançar status no KDS funciona sem internet"
```

---

## Task 6: Fechar conta offline (closeTableSession e closeCounterOrder)

**Files:**
- Modify: `lib/api.ts` (`closeTableSession`, `closeCounterOrder`)

**Interfaces:**
- Consumes: mesmo padrão das Tasks 4-5.
- Produces: nada novo.

**Nota de complexidade**: `closeCounterOrder` primeiro chama
`/api/orders/pagamento-balcao` (rota de servidor, não RPC — grava
`payment_details`) e SÓ DEPOIS chama a RPC `close_counter_order_secure`.
As duas chamadas fazem parte da MESMA ação de negócio ("fechar e
registrar pagamento") — se estiver offline, as duas ficam pra
sincronizar juntas na mesma entrada da fila, nunca só uma das duas.

- [ ] **Step 1: `closeTableSession` — mesmo padrão, duas RPCs em sequência**

```ts
export const closeTableSession = async (
  tableId: string,
  paymentData?: { total: number; methods: { method: string; amount: number; brand?: string | null }[]; emitir_nota?: boolean; cash_shift_id?: string },
  destinatario?: { cpfCnpj: string; nome: string },
): Promise<{ success: boolean; message?: string }> => {
  const paymentMethod = paymentData
    ? (paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE')
    : null;

  try {
    const { error: closeErr } = await supabase.rpc('close_table_orders_secure', {
      p_table_id: tableId,
      p_payment_method: paymentMethod,
      p_payment_details: paymentData || null,
    });
    if (closeErr) throw closeErr;

    const { error: finalizeErr } = await supabase.rpc('finalize_table_secure', { p_table_id: tableId });
    if (finalizeErr) throw finalizeErr;

    triggerOrdemProducao({ tableId });
    triggerEmissaoFiscal({ tableId, destinatario });
    return { success: true };
  } catch (e) {
    if (!isNetworkError(e)) {
      return { success: false, message: (e as Error).message || 'Erro desconhecido.' };
    }
    // As duas RPCs (close + finalize) E os dois triggers fire-and-forget
    // (Ordem de Produção, emissão fiscal) ficam pra rodar juntos quando
    // a ação sincronizar de verdade (ver Task 8) — nunca no clique offline.
    await enqueue('close_table_session', { tableId, paymentMethod, paymentData: paymentData || null, destinatario });
    return { success: true };
  }
};
```

- [ ] **Step 2: `closeCounterOrder` — inclui a chamada `/api/orders/pagamento-balcao`**

```ts
export const closeCounterOrder = async (
  orderId: string,
  paymentData?: { total: number; methods: { method: string; amount: number; brand?: string | null }[]; emitir_nota?: boolean; cash_shift_id?: string },
  destinatario?: { cpfCnpj: string; nome: string },
) => {
  try {
    if (paymentData) {
      const paymentMethod = paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE';
      const res = await fetch(resolverUrlApi('/api/orders/pagamento-balcao'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, paymentMethod, paymentDetails: paymentData }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || 'Falha ao registrar o pagamento do pedido de balcão.');
      }
    }
    const { error } = await supabase.rpc('close_counter_order_secure', { p_order_id: orderId });
    if (error) throw error;
    triggerOrdemProducao({ orderId });
    triggerEmissaoFiscal({ orderId, destinatario });
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await enqueue('close_counter_order', { orderId, paymentData: paymentData || null, destinatario });
  }
};
```

(nota: `fetch()` pra uma rota de servidor que está fora do ar por falta
de internet também lança `TypeError: Failed to fetch` — `isNetworkError`
já cobre esse caso, mesmo padrão que as chamadas RPC.)

- [ ] **Step 3: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Verificação ao vivo**

Offline: fechar uma mesa com pagamento em dinheiro, e separadamente
fechar um pedido de balcão com pagamento. Confirmar que os dois liberam
a mesa/saem da lista de balcão na tela, e que a fila ganhou as entradas
`close_table_session`/`close_counter_order` correspondentes.

- [ ] **Step 5: Commit**

```bash
git add lib/api.ts
git commit -m "feat(offline): fechar conta de mesa e de balcão funciona sem internet"
```

---

## Task 7: Caixa offline (openCashShift, closeCashShift, registerCashMovement)

**Files:**
- Modify: `lib/api.ts` (`openCashShift`, `closeCashShift`,
  `registerCashMovement`)

**Interfaces:**
- Consumes: mesmo padrão das Tasks 4-6.
- Produces: nada novo.

- [ ] **Step 1: Aplicar o mesmo padrão de try/catch + enqueue nas 3 funções**

Seguir exatamente o modelo da Task 5 (RPC única, resposta já no formato
`{success, ...}`) pra cada uma. **Importante**: o payload enfileirado
precisa usar os nomes de parâmetro EXATOS da RPC (prefixo `p_`), porque
o motor de sync (Task 8) repassa esse objeto direto pra
`supabase.rpc(nome, payload)`, sem transformação nenhuma.

- `openCashShift(storeId, operatorUserId, openingFloat, notes?)` →
  enfileira `'open_cash_shift'` com
  `{ p_store_id: storeId, p_operator_user_id: operatorUserId, p_opening_float: openingFloat, p_notes: notes ?? null }`.
- `closeCashShift(shiftId, closingCountedCash, closingCashBreakdown?, maxTolerance?, approvedByUserId?)` →
  enfileira `'close_cash_shift'` com
  `{ p_shift_id: shiftId, p_closing_counted_cash: closingCountedCash, p_closing_cash_breakdown: closingCashBreakdown ?? null, p_max_tolerance: maxTolerance ?? null, p_approved_by_user_id: approvedByUserId ?? null }`.
- `registerCashMovement(shiftId, type, amount, reason, operatorName?, alertThreshold?)` →
  enfileira `'register_cash_movement'` com
  `{ p_shift_id: shiftId, p_type: type, p_amount: amount, p_reason: reason, p_operator_name: operatorName ?? null, p_alert_threshold: alertThreshold ?? null }`.

Pra todas as 3: se a RPC devolver `{success: false}` de negócio (ex.
"já existe turno aberto", "turno já fechado"), isso NÃO é erro de rede
— sobe normal, sem enfileirar. Só uma falha de rede de verdade
(`isNetworkError`) enfileira.

- [ ] **Step 2: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 3: Verificação ao vivo**

Offline: abrir turno de caixa, fazer uma sangria, fechar o turno.
Confirmar que a tela do Caixa reflete cada ação na hora e que a fila
ganhou as 3 entradas correspondentes.

- [ ] **Step 4: Commit**

```bash
git add lib/api.ts
git commit -m "feat(offline): abrir/fechar caixa e sangria/suprimento funcionam sem internet"
```

---

## Task 8: Motor de sincronização

**Files:**
- Create: `lib/offline/sync.ts`
- Modify: `components/modules/StoreModule.tsx` (`StoreLayout` — inicia o
  motor de sync quando o painel monta)

**Interfaces:**
- Consumes: `getPendingActions`, `markDone`, `markFailed`,
  `checkRealConnectivity` (Tasks 1-2), e as funções já modificadas
  (`createOrder`, `updateOrderItemStatus`, `closeTableSession`,
  `closeCounterOrder`, `openCashShift`, `closeCashShift`,
  `registerCashMovement` — Tasks 4-7), `triggerOrdemProducao`/
  `triggerEmissaoFiscal` (já existem em `lib/api.ts`, precisam virar
  exportadas se ainda não forem — checar com
  `grep -n "^const triggerOrdemProducao\|^const triggerEmissaoFiscal" lib/api.ts`
  e trocar `const` por `export const` se necessário).
- Produces: `startOfflineSync()` (chamado uma vez, no mount do painel),
  `getSyncStatus()` (consumido pela Task 9, indicador visual).

- [ ] **Step 1: Confirmar se os triggers precisam ser exportados**

```bash
grep -n "^const triggerOrdemProducao\|^const triggerEmissaoFiscal\|^export const triggerOrdemProducao\|^export const triggerEmissaoFiscal" lib/api.ts
```

Se aparecerem como `const` (não `export const`), trocar pra
`export const` nas duas declarações — são usadas de dentro de
`lib/api.ts` hoje, exportá-las não muda nada pra quem já as usa lá
dentro.

- [ ] **Step 2: Criar `lib/offline/sync.ts`**

**Decisão de design importante**: o motor de sync chama a RPC/rota de
servidor **diretamente** (`supabase.rpc(...)`, `fetch(...)`) — nunca as
funções já "embrulhadas" de `lib/api.ts` (`createOrder`,
`closeTableSession` etc). Se chamasse as versões embrulhadas, uma falha
de rede DURANTE a própria sincronização cairia no mesmo catch que
enfileira de novo (Tasks 4-7), duplicando a entrada na fila em vez de
deixar o motor de sync marcar a tentativa como falha (`markFailed`) e
seguir pra próxima ação. `triggerOrdemProducao`/`triggerEmissaoFiscal`
continuam sendo chamados normalmente (já são fire-and-forget, não têm
esse problema).

```ts
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
      const { error: closeErr } = await supabase.rpc('close_table_orders_secure', {
        p_table_id: payload.tableId, p_payment_method: payload.paymentMethod, p_payment_details: payload.paymentData,
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
      if (payload.paymentData) {
        const paymentMethod = payload.paymentData.methods.length === 1 ? payload.paymentData.methods[0].method : 'MULTIPLE';
        const res = await fetch(resolverUrlApi('/api/orders/pagamento-balcao'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: payload.orderId, paymentMethod, paymentDetails: payload.paymentData }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message || 'Falha ao registrar o pagamento do pedido de balcão.');
        }
      }
      const { error } = await supabase.rpc('close_counter_order_secure', { p_order_id: payload.orderId });
      if (error) throw error;
      triggerOrdemProducao({ orderId: payload.orderId });
      triggerEmissaoFiscal({ orderId: payload.orderId, destinatario: payload.destinatario });
      break;
    }
    case 'open_cash_shift': {
      const payload = action.payload as any;
      const { error } = await supabase.rpc('open_cash_shift_secure', payload);
      if (error) throw error;
      break;
    }
    case 'close_cash_shift': {
      // Implementador: montar a chamada supabase.rpc('close_cash_shift_secure', ...)
      // com os mesmos parâmetros lidos na Task 7 — mesmo padrão dos casos acima
      // (chamada direta à RPC, nunca via lib/api.ts).
      const payload = action.payload as any;
      const { error } = await supabase.rpc('close_cash_shift_secure', payload);
      if (error) throw error;
      break;
    }
    case 'register_cash_movement': {
      const payload = action.payload as any;
      const { error } = await supabase.rpc('register_cash_movement_secure', payload);
      if (error) throw error;
      break;
    }
  }
}

let syncing = false;

export async function runSync(): Promise<void> {
  if (syncing) return; // nunca duas sincronizações em paralelo
  const online = await checkRealConnectivity();
  if (!online) {
    const pending = (await getPendingActions()).length;
    notify({ syncing: false, pending, failed: 0 });
    return;
  }

  syncing = true;
  const idMap = new Map<string, string>();
  try {
    const actions = await getPendingActions(); // já vem ordenado por createdAt
    let failedCount = 0;
    for (const action of actions) {
      // Sequencial de propósito (Global Constraint: nunca em paralelo —
      // evita condição de corrida entre ações da mesma mesa).
      try {
        await processAction(action, idMap);
        await markDone(action.id);
      } catch (e) {
        await markFailed(action.id, (e as Error).message || 'Erro desconhecido');
        if (action.attempts + 1 >= MAX_ATTEMPTS) failedCount += 1;
        // Continua pra próxima ação da fila mesmo com esta falhando —
        // Global Constraint: uma falha nunca trava as ações seguintes.
      }
    }
    const remaining = await getPendingActions();
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
```

- [ ] **Step 3: Iniciar o motor no `StoreLayout`**

Em `components/modules/StoreModule.tsx`, dentro de `StoreLayout` (por
volta da linha 425-440, junto dos outros `useEffect` de inicialização):

```tsx
useEffect(() => {
  startOfflineSync();
}, []);
```

Import novo: `import { startOfflineSync } from '@/lib/offline/sync';`

- [ ] **Step 4: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Verificação ao vivo (ponta a ponta)**

Offline: lançar 2-3 ações diferentes (pedido, avançar status, fechar
conta). Confirmar que todas ficam na fila (IndexedDB → queue, várias
entradas). Religar a internet (DevTools → Network → desmarcar
"Offline"). Esperar até 30s (ou disparar manualmente reconectando a
rede de verdade, que aciona o evento `online`). Confirmar: (a) a fila
esvazia (IndexedDB → queue fica vazia); (b) os dados aparecem
corretamente no banco de produção (`node scripts/db.mjs "select ..."`
ou olhando a tela de outro dispositivo/aba logada na mesma loja); (c)
nenhuma duplicata foi criada.

- [ ] **Step 6: Commit**

```bash
git add lib/offline/sync.ts components/modules/StoreModule.tsx
git commit -m "feat(offline): motor de sincronização — processa a fila em ordem quando a conexão volta"
```

---

## Task 9: Indicador visual de status offline/sincronização

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`StoreLayout` — perto de
  `CaixaPrintStationIndicator`)

**Interfaces:**
- Consumes: `getSyncStatus`, `onSyncStatusChange` (Task 8).
- Produces: nada consumido por outra task — é a última peça visível do
  plano.

- [ ] **Step 1: Adicionar estado local + subscrição**

Em `StoreLayout`:

```tsx
const [syncStatus, setSyncStatus] = useState(getSyncStatus());
useEffect(() => {
  const unsubscribe = onSyncStatusChange(setSyncStatus);
  return unsubscribe;
}, []);
```

Imports novos: `import { getSyncStatus, onSyncStatusChange } from '@/lib/offline/sync';`

- [ ] **Step 2: Renderizar o badge ao lado de `CaixaPrintStationIndicator`**

Localizar os dois pontos onde `CaixaPrintStationIndicator` já é
renderizado (header mobile ~linha 509, header desktop ~linha 709) e
adicionar ao lado:

```tsx
{syncStatus.failed > 0 ? (
  <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-[var(--err)]/10 text-[var(--err)] border border-[var(--err)]/30">
    🔴 {syncStatus.failed} falha(s) — verificar
  </span>
) : syncStatus.pending > 0 ? (
  <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-[var(--warn)]/10 text-[var(--warn)] border border-[var(--warn)]/30">
    🟡 Offline — {syncStatus.pending} pendente(s)
  </span>
) : null /* fila vazia e sem falha: nenhum badge, mesmo comportamento visual de hoje */}
```

(nota: "🟢 Sincronizado" do spec foi simplificado pra "nenhum badge" no
caso normal — evita poluir visualmente o header o tempo todo quando
está tudo certo, que é o estado mais comum. Se o usuário preferir o
badge verde sempre visível, é uma troca de 1 linha nesta condicional.)

- [ ] **Step 3: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Verificação ao vivo**

Offline com ações pendentes: confirmar que o badge amarelo aparece com
a contagem certa. Religar e esperar sincronizar: confirmar que o badge
some.

- [ ] **Step 5: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat(offline): indicador visual de status offline/pendências no header"
```

---

## Task 10: Verificação final ponta a ponta

**Files:** nenhum arquivo novo — task de verificação, sem código.

**Interfaces:**
- Consumes: tudo das Tasks 1-9.

- [ ] **Step 1: Cenário completo, ao vivo, na ZZ Laboratorio**

1. Logar normalmente (online).
2. Deixar cardápio e mesas carregarem.
3. Ativar offline (DevTools → Network → Offline, ou desconectar o
   Wi-Fi/cabo de verdade se estiver testando no app empacotado).
4. Lançar pedido numa mesa → confirmar tela + impressão.
5. Avançar o item no KDS.
6. Fechar a conta dessa mesa com pagamento em dinheiro.
7. Abrir turno de caixa, fazer uma sangria, fechar o turno.
8. Reconectar a internet.
9. Esperar a sincronização automática (até 30s).
10. Confirmar no banco (`node scripts/db.mjs`) que TODAS as ações
    chegaram, na ordem certa, sem duplicata.
11. Confirmar que a nota fiscal (se a loja tiver emissão automática
    configurada) foi disparada só depois da sincronização, não durante
    o período offline.

- [ ] **Step 2: Cenário de falha real**

Repetir o fluxo, mas desta vez criar uma situação de falha genuína numa
ação da fila (ex. fechar uma mesa que já foi fechada por outro caminho
antes da sincronização rodar). Confirmar: (a) as ações seguintes da
fila sincronizam mesmo assim; (b) depois de 3 tentativas, o indicador
mostra "🔴 falha(s)"; (c) a ação com falha continua na fila (não
desaparece silenciosamente).

- [ ] **Step 3: Limpar dado de teste**

Apagar qualquer pedido/mesa/turno de teste criado durante a verificação
(via `node scripts/db.mjs` ou pela própria UI), deixando a ZZ
Laboratorio no estado limpo de sempre.

- [ ] **Step 4: Registrar o resultado**

Sem commit nesta task — anotar no relatório desta task o resultado dos
dois cenários acima, e qualquer achado que precise virar ajuste (não
implementar o ajuste na hora se for grande — registrar como finding pro
controlador decidir).
