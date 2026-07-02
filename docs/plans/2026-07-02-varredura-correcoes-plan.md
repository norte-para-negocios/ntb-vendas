# Correções da Varredura Completa — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Corrigir os achados de segurança, bugs, performance e acessibilidade
da varredura completa do repo (sessão de 2026-07-02), SEM implementar
nenhuma das "novas features" (essas ficam em standby, seção própria no
final deste doc, só pra registro — não executar agora).

**Architecture:** Trabalho organizado em 5 tracks. **M** (migrations) e
**A** (lib/api.ts + lib/calc.ts novo) são sequenciais entre si e
bloqueantes pra quem depende delas. **S** (StoreModule.tsx) e **C**
(ClientModule.tsx) são internamente sequenciais (mesmo arquivo gigante,
edições concorrentes colidiriam) mas podem rodar em paralelo uma com a
outra. **I** (arquivos pequenos independentes) roda em paralelo com tudo.
**D** (AGENTS.md) é o último passo.

**Tech Stack:** igual ao resto do projeto — Next.js 16, Supabase
(Postgres + Storage + Realtime), sem framework de teste (só
`npm run build` como rede de segurança, mesmo padrão já usado nos planos
anteriores deste repo).

**Decisão já tomada com o usuário:** "Excluir Loja" vira soft-delete
(`is_active = false`) em vez de apagar em cascata pra sempre.

**Nota sobre migrations:** este ambiente não tem `.env.local` (mesmo
bloqueio do plano anterior, `2026-07-01-alerta-cliente-e-certificado-fiscal-plan.md`).
As migrations desta track ficam **escritas e commitadas, mas não
aplicadas no banco** até alguém rodar
`node scripts/aplicar-migration.mjs <arquivo>.sql` com as credenciais.

---

## Track M — Migrations (sequencial)

### Task M1: `007_seguranca_pedidos.sql`

**Files:** Create `supabase/migrations/007_seguranca_pedidos.sql`

Cobre 3 achados de segurança:
- **PIN de mesa sem rate limit** (achado #1): adicionar `pin_attempts int
  not null default 0` e `pin_locked_until timestamptz` em `tables`;
  `open_table_session` passa a incrementar tentativa a cada PIN errado,
  bloquear por 5 minutos após 5 tentativas, e resetar o contador no
  sucesso.
- **Preço adulterável no client** (achado #2): nova function
  `create_order_secure(p_table_id uuid, p_store_id uuid, p_order_type
  text, p_customer_name text, p_items jsonb)` — recebe só
  `product_id`/`quantity`/`notes` do client (nunca preço), busca o preço
  REAL em `products` dentro da própria function, monta `orders` +
  `order_items` com esse preço server-side, e retorna o pedido criado.
  Substitui o insert direto que `createOrder` faz hoje em `lib/api.ts`.
- **Sem CHECK de preço/quantidade não-negativos** (achado #6): `alter
  table products add constraint products_price_check check (price >=
  0)`; `alter table order_items add constraint order_items_quantity_check
  check (quantity > 0)`; `alter table order_items add constraint
  order_items_price_check check (price_at_time >= 0)`.

```sql
-- Track M / Task M1 — hardening de pedidos: rate-limit de PIN, preco
-- validado no servidor, CHECK constraints. Ver varredura de 2026-07-02.

alter table tables add column if not exists pin_attempts int not null default 0;
alter table tables add column if not exists pin_locked_until timestamptz;

create or replace function public.open_table_session(
  p_table_id uuid,
  p_host_name text,
  p_pin text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table tables%rowtype;
  v_store stores%rowtype;
  v_pin_required boolean;
  v_is_host boolean;
begin
  select * into v_table from tables where id = p_table_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Mesa não encontrada.');
  end if;

  if v_table.status = 'blocked' then
    return jsonb_build_object('success', false, 'message', 'Esta mesa está bloqueada.');
  end if;

  if v_table.pin_locked_until is not null and v_table.pin_locked_until > now() then
    return jsonb_build_object('success', false, 'message', 'Muitas tentativas de PIN incorreto. Tente novamente em alguns minutos.');
  end if;

  select * into v_store from stores where id = v_table.store_id;

  v_pin_required := (v_table.status <> 'available')
                     or coalesce((v_store.config->>'require_pin_for_open')::boolean, false);

  if v_pin_required and (p_pin is null or p_pin <> v_table.pin) then
    update tables set
      pin_attempts = pin_attempts + 1,
      pin_locked_until = case when pin_attempts + 1 >= 5 then now() + interval '5 minutes' else pin_locked_until end
    where id = p_table_id;

    return jsonb_build_object(
      'success', false,
      'message', case when v_table.status <> 'available'
                      then 'Mesa já ocupada! Peça o PIN ao anfitrião.'
                      else 'PIN incorreto.' end
    );
  end if;

  update tables set pin_attempts = 0, pin_locked_until = null where id = p_table_id;

  if v_table.status = 'available' then
    update tables set status = 'occupied', current_host_name = p_host_name where id = p_table_id;
    v_is_host := true;
    v_table.current_host_name := p_host_name;
  else
    v_is_host := (lower(v_table.current_host_name) = lower(p_host_name));
  end if;

  return jsonb_build_object(
    'success', true,
    'is_host', v_is_host,
    'table', jsonb_build_object(
      'id', v_table.id,
      'store_id', v_table.store_id,
      'number', v_table.number,
      'status', case when v_table.status = 'available' then 'occupied' else v_table.status end,
      'current_host_name', v_table.current_host_name,
      'guest_count', v_table.guest_count,
      'waiter_requested', v_table.waiter_requested,
      'service_fee_removed', v_table.service_fee_removed,
      'pin', case when v_is_host then v_table.pin else null end
    )
  );
end;
$$;

grant execute on function public.open_table_session(uuid, text, text) to anon, authenticated;

-- ─── Pedido com preço validado no servidor ────────────────────────────────────
create or replace function public.create_order_secure(
  p_table_id uuid,
  p_store_id uuid,
  p_order_type text,
  p_customer_name text,
  p_items jsonb -- [{product_id, quantity, notes}]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product products%rowtype;
  v_total numeric := 0;
  v_line_total numeric;
begin
  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', 'Pedido sem itens.');
  end if;

  insert into orders (table_id, store_id, status, order_type, total, customer_name)
  values (p_table_id, p_store_id, 'pending', p_order_type, 0, p_customer_name)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_product from products where id = (v_item->>'product_id')::uuid and store_id = p_store_id;
    if not found then
      raise exception 'Produto inválido para esta loja.';
    end if;
    if (v_item->>'quantity')::int <= 0 then
      raise exception 'Quantidade inválida.';
    end if;

    v_line_total := v_product.price * (v_item->>'quantity')::int;
    v_total := v_total + v_line_total;

    insert into order_items (order_id, product_id, quantity, status, notes, price_at_time)
    values (v_order_id, v_product.id, (v_item->>'quantity')::int, 'pending', v_item->>'notes', v_product.price);
  end loop;

  update orders set total = v_total where id = v_order_id;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end;
$$;

grant execute on function public.create_order_secure(uuid, uuid, text, text, jsonb) to anon, authenticated;

-- ─── CHECK constraints ─────────────────────────────────────────────────────────
alter table products drop constraint if exists products_price_check;
alter table products add constraint products_price_check check (price >= 0);

alter table order_items drop constraint if exists order_items_quantity_check;
alter table order_items add constraint order_items_quantity_check check (quantity > 0);

alter table order_items drop constraint if exists order_items_price_check;
alter table order_items add constraint order_items_price_check check (price_at_time >= 0);
```

**Step 2:** Aplicar (quando houver `.env.local`): `node
scripts/aplicar-migration.mjs 007_seguranca_pedidos.sql`

**Step 3:** Commit: `feat: rate-limit de PIN, pedido com preco validado no servidor, CHECK constraints`

---

### Task M2: `008_seguranca_login.sql`

**Files:** Create `supabase/migrations/008_seguranca_login.sql`

Rate-limit pro login de admin (`system_admins`) e lojista (`store_users`)
— achado #5. Mesmo padrão do M1: colunas de tentativa + lockout, novas
functions `security definer` que substituem a comparação de senha feita
hoje direto no client em `lib/api.ts`.

```sql
-- Track M / Task M2 — rate-limit de login (admin + lojista).

alter table system_admins add column if not exists login_attempts int not null default 0;
alter table system_admins add column if not exists login_locked_until timestamptz;
alter table store_users add column if not exists login_attempts int not null default 0;
alter table store_users add column if not exists login_locked_until timestamptz;

create or replace function public.authenticate_admin_secure(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin system_admins%rowtype;
begin
  select * into v_admin from system_admins where username = p_username for update;
  if not found then
    return jsonb_build_object('success', false);
  end if;

  if v_admin.login_locked_until is not null and v_admin.login_locked_until > now() then
    return jsonb_build_object('success', false, 'locked', true);
  end if;

  if v_admin.password <> p_password then
    update system_admins set
      login_attempts = login_attempts + 1,
      login_locked_until = case when login_attempts + 1 >= 5 then now() + interval '5 minutes' else login_locked_until end
    where id = v_admin.id;
    return jsonb_build_object('success', false);
  end if;

  update system_admins set login_attempts = 0, login_locked_until = null where id = v_admin.id;
  return jsonb_build_object('success', true, 'mustChangePass', v_admin.must_change_password, 'userId', v_admin.id);
end;
$$;

grant execute on function public.authenticate_admin_secure(text, text) to anon, authenticated;

create or replace function public.authenticate_store_user_secure(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user store_users%rowtype;
begin
  select * into v_user from store_users where email = p_email for update;
  if not found then
    return jsonb_build_object('success', false);
  end if;

  if v_user.login_locked_until is not null and v_user.login_locked_until > now() then
    return jsonb_build_object('success', false, 'locked', true);
  end if;

  if v_user.password <> p_password then
    update store_users set
      login_attempts = login_attempts + 1,
      login_locked_until = case when login_attempts + 1 >= 5 then now() + interval '5 minutes' else login_locked_until end
    where id = v_user.id;
    return jsonb_build_object('success', false);
  end if;

  update store_users set login_attempts = 0, login_locked_until = null where id = v_user.id;
  return jsonb_build_object(
    'success', true,
    'mustChangePass', v_user.must_change_password,
    'user', jsonb_build_object('id', v_user.id, 'store_id', v_user.store_id, 'name', v_user.name,
      'email', v_user.email, 'role', v_user.role, 'permissions', v_user.permissions)
  );
end;
$$;

grant execute on function public.authenticate_store_user_secure(text, text) to anon, authenticated;
```

**Step 2:** Aplicar quando houver credenciais.
**Step 3:** Commit: `feat: rate-limit de login pro admin e lojista via RPC`

---

### Task M3: `009_indices_realtime_e_soft_delete.sql`

**Files:** Create `supabase/migrations/009_indices_realtime_e_soft_delete.sql`

Cobre achados #8 (índice composto), #10 (policy de DELETE pro
certificado), e a denormalização de `store_id` em `order_items` pra
resolver o fan-out global de Realtime (achado de performance #1 / bug
#9 — é o mesmo achado visto de dois ângulos).

```sql
-- Track M / Task M3 — indice composto p/ historico de vendas, policy de
-- delete p/ certificado, store_id denormalizado em order_items p/ filtrar
-- Realtime por loja (hoje qualquer evento em QUALQUER loja da plataforma
-- dispara refetch em todo cliente conectado — ver varredura 2026-07-02).

create index if not exists idx_orders_store_status_created on orders(store_id, status, created_at desc);

alter table order_items add column if not exists store_id uuid references stores(id);

update order_items oi set store_id = o.store_id
from orders o where o.id = oi.order_id and oi.store_id is null;

alter table order_items alter column store_id set not null;
create index if not exists idx_order_items_store_id on order_items(store_id);

-- Trigger pra manter store_id sincronizado em novos inserts que não passem
-- pela function create_order_secure (ex.: algum insert direto remanescente).
create or replace function public.set_order_item_store_id() returns trigger
language plpgsql as $$
begin
  if new.store_id is null then
    select store_id into new.store_id from orders where id = new.order_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_order_item_store_id on order_items;
create trigger trg_set_order_item_store_id
  before insert on order_items
  for each row execute function public.set_order_item_store_id();

-- ─── Policy de DELETE pro bucket do certificado (achado #10: arquivo fica
-- orfao no Storage quando a loja e excluida, hoje nao ha como limpar) ────────
drop policy if exists "cert_delete_anon" on storage.objects;
create policy "cert_delete_anon" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'store-certificates');
```

**Step 2:** Aplicar quando houver credenciais.
**Step 3:** Commit: `feat: indice composto, store_id em order_items p/ realtime por loja, policy de delete do certificado`

---

## Track A — `lib/api.ts` + `lib/calc.ts` (sequencial, depende de M1-M3)

### Task A1: `lib/calc.ts` (novo — elimina duplicação de fórmula)

**Files:** Create `lib/calc.ts`

Extrai a fórmula de taxa de serviço (hoje duplicada em 7+ lugares entre
`StoreModule.tsx` e `ClientModule.tsx`, achado de performance #4) e a
lógica de split por pessoa (achado #5) em funções puras e testáveis
(mesmo sem framework de teste hoje, ficam isoladas o suficiente pra
alguém escrever teste depois sem precisar montar toda a árvore de
componentes).

```ts
// Fonte única da fórmula de taxa de serviço e split de conta — antes
// duplicada em 7+ lugares entre StoreModule.tsx e ClientModule.tsx.
// Percentual ainda é fixo em 10% (torná-lo configurável por loja é a
// feature "taxa de serviço configurável" do backlog de produto — fora
// de escopo desta correção).
export const SERVICE_FEE_RATE = 0.10;

export function calculateServiceFee(subtotal: number): number {
  return subtotal * SERVICE_FEE_RATE;
}

export function calculateOrderTotal(subtotal: number, chargeServiceFee: boolean, serviceFeeRemoved?: boolean): number {
  if (!chargeServiceFee || serviceFeeRemoved) return subtotal;
  return subtotal + calculateServiceFee(subtotal);
}

export interface SplitItem {
  userName: string;
  subtotal: number;
}

export function calculateSplitByPerson(items: SplitItem[], chargeServiceFee: boolean): Map<string, number> {
  const bySubtotal = new Map<string, number>();
  for (const item of items) {
    bySubtotal.set(item.userName, (bySubtotal.get(item.userName) || 0) + item.subtotal);
  }
  const result = new Map<string, number>();
  for (const [name, subtotal] of bySubtotal) {
    result.set(name, calculateOrderTotal(subtotal, chargeServiceFee));
  }
  return result;
}

export function calculateChange(amountPaid: number, total: number): number {
  return Math.max(0, amountPaid - total);
}
```

**Step 2:** `npm run build`. **Step 3:** Commit: `feat: extrai calculo de taxa de servico e split de conta pra lib/calc.ts`

*(A ligação desses helpers nos call sites de `StoreModule.tsx`/`ClientModule.tsx` acontece nas Tasks S3/C1, não aqui — commitar o arquivo isolado primeiro.)*

### Task A2: Atualizar `lib/api.ts`

**Files:** Modify `lib/api.ts`

1. `createOrder`: trocar o insert direto (que manda `price_at_time` vindo
   do client) por uma chamada a `supabase.rpc('create_order_secure', {
   p_table_id, p_store_id, p_order_type, p_customer_name, p_items })`,
   onde `p_items` é montado SEM preço (só `product_id`, `quantity`,
   `notes`). Manter a assinatura pública de `createOrder` igual (mesmos
   parâmetros de entrada), só trocar a implementação interna — nenhum
   call site em `ClientModule.tsx` precisa mudar.
2. `authenticateAdmin`/`authenticateStoreUser`: trocar a comparação de
   senha feita no client por `supabase.rpc('authenticate_admin_secure',
   ...)`/`supabase.rpc('authenticate_store_user_secure', ...)`. Manter
   assinatura e formato de retorno idênticos aos atuais.
3. `fetchActiveOrdersForTables`: adicionar `.order('created_at')` antes
   do `.limit(500)` (achado #7).
4. `fetchSalesHistory`: adicionar parâmetros opcionais `startDate`/
   `endDate` e aplicar `.gte('created_at', startDate).lte('created_at',
   endDate)` quando informados (achado #8) — manter comportamento atual
   (sem filtro) se os parâmetros não forem passados, pra não quebrar os
   call sites existentes ainda sem UI de filtro de data.
5. `deleteStore`: **virar soft-delete** — trocar o delete em cascata por
   `update stores set is_active = false where id = storeId` (decisão já
   tomada com o usuário). Antes de desativar, chamar
   `supabase.storage.from('store-certificates').remove([...])` pra
   limpar o certificado órfão (achado #10) — listar objetos daquele
   `storeId/` (agora que existe policy de DELETE, Task M3) e removê-los.
6. Qualquer `supabase.channel(...)` que assine `order_items` sem filtro
   (usado por `useStoreNotifications` e pontos equivalentes) passa a
   usar `filter: store_id=eq.${storeId}` agora que a coluna existe
   (Task M3) — ver Tasks S1-S3 para os pontos dentro de
   `StoreModule.tsx`, mas se `lib/api.ts` tiver alguma função de
   assinatura centralizada, ajustar aqui também.

**Step 2:** `npm run build`. **Step 3:** Commit: `feat: pedido/login via RPC segura, soft-delete de loja, paginacao/filtro de data`

---

## Track S — `components/modules/StoreModule.tsx` (sequencial internamente)

### Task S1: Extrair `KdsView` compartilhado (dedup KitchenView/BarView)

**Files:** Modify `components/modules/StoreModule.tsx`

`KitchenView` (linhas ~433-605) e `BarView` (~607-780) são ~150 linhas
quase idênticas (achado de bug #8) — mesmo state, mesmo `advanceStatus`,
mesma função `parseItemNote` duplicada literalmente, mesmo JSX de card,
só muda o parâmetro de destino (`kitchen`/`bar`). Extrair um único
`KdsView({ destination: 'kitchen' | 'bar', store })` parametrizado que
os dois usam. **Preservar o comportamento exatamente como está** nesta
task — as correções (erro tratado, som, indicador de atraso) entram na
Task S2, em cima do componente já unificado, pra não escrever a mesma
correção duas vezes.

**Step 2:** `npm run build` + smoke test (`npm run dev`, abrir `/loja`,
confirmar que cozinha e bar ainda funcionam visualmente iguais).
**Step 3:** Commit: `refactor: unifica KitchenView e BarView num KdsView compartilhado`

### Task S2: Correções no `KdsView` unificado

**Files:** Modify `components/modules/StoreModule.tsx`

1. **Erro tratado no avanço de status** (achado de bug #1): `advanceStatus`
   passa a checar `{ error }` do retorno de `updateOrderItemStatus` — em
   caso de erro, reverter o update otimista (recolocar o item no estado
   anterior) e `toast.error('Não foi possível atualizar o status. Tente novamente.')`.
   Isso também exige ajustar `updateOrderItemStatus` em `lib/api.ts` pra
   retornar `{ success, message }` em vez de ignorar `error` (hoje em
   `lib/api.ts:550-552`).
2. **Alerta sonoro de pedido novo** (achado de bug #7): reusar
   `lib/audioAlert.ts` (`playPreparingAlert` já serve, ou criar
   `playNewOrderAlert` se quiser um tom distinto) — disparar quando o
   Realtime trouxer um item novo com `status = 'pending'` que não
   existia no snapshot anterior (mesmo padrão de diff por `useRef` já
   usado no `OrderTracker` do `ClientModule.tsx`, Track A do plano
   anterior).
3. **Indicador de pedido atrasado** (achado de bug #11): comparar
   `created_at` do item com `product.prep_time_minutes`; se
   `now() - created_at > prep_time_minutes`, aplicar destaque visual
   (borda vermelha/badge "Atrasado") no card.

**Step 2:** `npm run build` + smoke test manual (novo pedido dispara som;
item velho aparece com indicador de atraso). **Step 3:** Commit:
`fix: erro tratado no avanco de status, alerta sonoro e indicador de atraso no KDS`

### Task S3: `TablesView` — erro tratado, troco, guarda de duplo clique, atribuição de garçom, cálculo compartilhado

**Files:** Modify `components/modules/StoreModule.tsx`

1. **"Abrir Mesa Manualmente" sem tratamento de erro** (achado de bug #3):
   envolver em `try/catch`, reverter o `setSelectedTable` otimista e
   `toast.error(...)` em caso de falha — mesmo padrão da Task S2.1.
2. **Cálculo de troco** (achado de bug #4): usar `calculateChange` de
   `lib/calc.ts` (Task A1) — exibir "Troco: R$ X" quando o valor pago em
   dinheiro exceder o total, ao lado do "Restante a Pagar" que já existe.
3. **Guarda contra duplo clique em "Finalizar Mesa"** (achado de bug #5):
   mesmo padrão `isSavingRef.current` já usado em `AdminModule.tsx`
   (`handleSaveStore`) — aplicar em `handleFinishPayment`.
4. **Atribuição de garçom** (achado de bug #10): `TablesView` passa a
   receber o usuário logado (`loggedUser: StoreUser`) como prop (threading
   desde `StoreModule` → `StoreAdminView`/shell, que já tem esse dado do
   login) e usa `loggedUser.name` em vez de `"Lojista"` fixo em
   `handleAddItem` e "Abrir Mesa Manualmente".
5. **Usar `lib/calc.ts`**: trocar as fórmulas inline de taxa de serviço
   (`subtotal * 0.1`, achado de performance #4) e o cálculo de
   `usersBreakdown` (achado de performance #14) pelas funções de
   `calculateServiceFee`/`calculateOrderTotal`/`calculateSplitByPerson`.

**Step 2:** `npm run build` + smoke test (pagamento com troco, mesa
com 2+ pessoas splitando conta, tentar duplo-clique em finalizar).
**Step 3:** Commit: `fix: erro tratado, troco, guarda de duplo clique, atribuicao de garcom e calculo compartilhado em TablesView`

### Task S4: `MenuManagementView` — produtos órfãos visíveis

**Files:** Modify `components/modules/StoreModule.tsx`

Achado de bug #2: excluir uma categoria deixa produtos órfãos
(`category_id = null`, FK `on delete set null`) invisíveis na UI, porque
a tela só renderiza produtos dentro do loop `categories.map(...)`.
Adicionar uma seção "Sem categoria" (renderizada quando existir pelo
menos 1 produto com `category_id === null`) com os mesmos controles de
editar/pausar/excluir que as outras categorias têm.

**Step 2:** `npm run build` + smoke test (excluir categoria com produto,
confirmar que o produto aparece em "Sem categoria" e continua editável).
**Step 3:** Commit: `fix: produtos orfaos (sem categoria) ficam visiveis e editaveis`

### Task S5: Persistência de sessão do lojista

**Files:** Modify `components/modules/StoreModule.tsx`

Achado de bug #6: F5 derruba o login no meio do turno (comentário no
código já reconhece isso: "Restore session check? Maybe later").
Guardar `{ userId, storeId }` no `localStorage` no login bem-sucedido;
no mount do `StoreModule`, se existir, re-buscar o `store_user` (via uma
nova `fetchStoreUserById` em `lib/api.ts`, pequena) e restaurar a sessão
sem pedir login de novo. Logout limpa o `localStorage`.

**Step 2:** `npm run build` + smoke test (logar, dar F5, confirmar que
continua logado; fazer logout, confirmar que F5 não restaura mais).
**Step 3:** Commit: `feat: persiste sessao do lojista no localStorage (sobrevive a F5)`

### Task S6: Performance — `next/image`, dynamic import do dashboard, menos refetch

**Files:** Modify `components/modules/StoreModule.tsx`

1. Trocar `<img>` por `next/image` nos pontos de logo/foto de produto
   dentro de `StoreModule.tsx` (achado de performance #2) — usar `fill`
   ou `width`/`height` fixos conforme o container.
2. `StoreDashboardView` (que importa `recharts`) passa a ser importado
   via `next/dynamic(() => import('./StoreDashboardView'), { ssr: false
   })` (achado de performance #6) — cozinha/bar/balcão não pagam o custo
   desse bundle.
3. Reduzir chamadas redundantes a `fetchStoreById` (achado de
   performance #9) — `TablesView`/`MenuManagementView` usam a `store`
   já recebida via prop do componente pai em vez de rebuscar a cada
   evento Realtime; só rebuscar se precisar de um dado que muda de fato
   (ex.: `service_fee_removed` já vem de `tables`, não de `stores`).

**Step 2:** `npm run build`. **Step 3:** Commit: `perf: next/image, dynamic import do dashboard, menos refetch redundante de store`

---

## Track C — `components/modules/ClientModule.tsx` (sequencial internamente, paralelo à Track S)

### Task C1: Corrigir vazamento de PIN + usar cálculo compartilhado

**Files:** Modify `components/modules/ClientModule.tsx`

1. **`BillSplitter` vaza PIN** (achado de segurança #3, o mais grave de
   UX/dados): trocar `supabase.from('tables').select('*').eq('id',
   tableId).single()` (linha ~631) por `fetchTablesPublic` (já existe em
   `lib/api.ts`, usado em outros lugares corretamente) ou um `.select()`
   explícito que **não** inclua a coluna `pin`.
2. Trocar a fórmula inline de taxa de serviço (repetida em ~3 pontos do
   `BillSplitter`) e o cálculo de split por pessoa por
   `calculateServiceFee`/`calculateOrderTotal`/`calculateSplitByPerson`
   de `lib/calc.ts` (Task A1) — mesma motivação da Task S3.5.

**Step 2:** `npm run build` + smoke test (abrir "Dividir Conta" como
convidado não-anfitrião, confirmar no Network tab que a resposta não
contém o campo `pin`). **Step 3:** Commit: `fix: BillSplitter nao expoe mais o PIN da mesa; usa calculo compartilhado`

### Task C2: Extrair `ProductCard` — teclado, aria, memo

**Files:** Modify `components/modules/ClientModule.tsx`

Três achados resolvidos numa passada só porque tocam o mesmo trecho de
código (o `.map()` de renderização de produto, linha ~1413-1444):
- **Não navegável por teclado** (achado de UX #1): trocar `<div
  onClick>` por `<button type="button">` (ou `<div role="button"
  tabIndex={0}>` com handler de `onKeyDown` pra Enter/Space, se o layout
  não permitir `<button>` puro por causa de elementos internos
  interativos).
- **Sem memoização** (achado de performance #7): extrair pra um
  componente `ProductCard` próprio envolto em `React.memo`, recebendo
  `product` e `onSelect` — evita que toda a lista re-renderize a cada
  ação de carrinho (que hoje re-renderiza tudo por causa do Context não
  memoizado, resolvido separadamente na Task I6).
- **Alvo de toque pequeno nos botões +/-** (achado de UX #9, mesma área
  de código): aumentar a área clicável dos botões de quantidade no
  carrinho/modal de produto pra pelo menos 44x44px (`p-2` em vez de
  `p-0.5`, por exemplo).

**Step 2:** `npm run build` + smoke test (navegar o cardápio só de
teclado — Tab até um produto, Enter pra abrir). **Step 3:** Commit:
`fix: ProductCard navegavel por teclado, memoizado, alvos de toque maiores`

### Task C3: Estados de erro/loading/confirmação

**Files:** Modify `components/modules/ClientModule.tsx`

Três achados de UX, mesma área do fluxo inicial do cliente:
- **Erro de rede vira "loja não encontrada"** (achado de UX #4):
  `fetchStoreBySlug`/`fetchMenu` em `lib/api.ts` passam a distinguir
  "não encontrado" (`PGRST116`/linha zero) de erro de rede/timeout —
  retornar um discriminador (`{ store: null, error: 'not_found' |
  'network' }`) em vez de só `null`. A tela em `ClientModule.tsx`
  (~linha 1257) ganha uma variante "Erro de conexão — Tentar de novo"
  com botão de retry quando o erro for de rede.
- **"Nenhum produto encontrado" durante o loading** (achado de UX #6):
  adicionar um `isLoadingMenu` explícito que só vira `false` depois que
  `fetchMenu` resolve, e checar esse flag antes de cair no branch de
  "vazio" (~linha 1445).
- **Adicionar ao carrinho sem confirmação** (achado de UX #5): disparar
  `toast.success('Adicionado ao carrinho!')` ou uma animação curta no
  botão flutuante do carrinho ao confirmar `addToCart`.

**Step 2:** `npm run build` + smoke test (recarregar com rede
desconectada no DevTools, confirmar tela de erro com retry; abrir
cardápio e confirmar que não pisca "nenhum produto" antes de carregar).
**Step 3:** Commit: `fix: distingue erro de rede de loja inexistente, corrige race de loading, confirma adicao ao carrinho`

### Task C4: `next/image` no ClientModule

**Files:** Modify `components/modules/ClientModule.tsx`

Achado de performance #2 (parte do ClientModule, que é a rota mais
visitada do sistema): trocar `<img>` por `next/image` nos pontos de
logo da loja e foto de produto.

**Step 2:** `npm run build`. **Step 3:** Commit: `perf: next/image no cardapio do cliente`

---

## Track I — Arquivos independentes (paralelo a tudo, cada task é um arquivo diferente)

### Task I1: `lib/print.ts` — escapar HTML, `noopener`

Achado de segurança #4. Adicionar uma função `escapeHtml(str: string):
string` local e aplicá-la em toda interpolação de `customer_name`/
`notes`/observação dentro dos templates de `document.write` (ticket de
cozinha/bar, comprovante, relatório). Trocar todo `window.open(...)`
sem terceiro argumento por `window.open('', '_blank', 'noopener')` (ou
adicionar `noopener` às features existentes).

`npm run build`. Commit: `fix: escapa HTML e adiciona noopener nos documentos impressos`

### Task I2: `components/ui.tsx` — `Modal` acessível, `Input` com label associado

Achados de UX #2 e #8. `Modal`: adicionar `role="dialog"`,
`aria-modal="true"`, foco no primeiro elemento focável ao abrir, `Tab`
preso dentro do modal (focus trap simples via `onKeyDown` capturando
`Tab`/`Shift+Tab` nos limites), e fechar com `Esc`
(`useEffect` com listener de `keydown` enquanto `isOpen`). `Input`:
gerar um `id` (via `useId()` do React) e usar `htmlFor` no `<label>`
associado.

`npm run build` + smoke test (abrir qualquer modal, apertar Esc, testar
Tab não escapa). Commit: `fix: Modal acessivel (dialog, focus trap, Esc) e Input com label associado`

### Task I3: `app/globals.css` — contraste dos tokens de status

Achado de UX #3. Escurecer levemente `--ok`, `--warn`, `--err`, `--info`
no tema claro até atingir contraste ≥4.5:1 contra fundo branco (checar
com qualquer calculadora de contraste — os valores atuais `#10b981`,
`#f59e0b`, `#F43F5E`, `#3b82f6` ficam entre 2.2:1 e 3.7:1). Conferir
visualmente que o tema escuro continua legível (os tokens podem ter
variante por tema, se o arquivo já usar `.dark { --ok: ... }` — seguir o
padrão existente).

`npm run build` + inspeção visual manual (claro e escuro). Commit: `fix: contraste WCAG AA nas cores semanticas de status`

### Task I4: `components/Toast.tsx` — `aria-live`

Achado de UX #11. Adicionar `role="status"` e `aria-live="polite"` no
container de toasts.

`npm run build`. Commit: `fix: toast anuncia mudanca de status pra leitor de tela`

### Task I5: PWA — `manifest.json` + ícones

Achado de UX #10. Criar `public/manifest.json` (nome "Norte Vendas" ou
nome da loja dinamicamente não é viável sem SSR por slug — usar nome
genérico do produto), ícones 192x192/512x512 (reaproveitar
`public/ntb-logo.png` se already existir em resolução suficiente, senão
gerar um simples), `theme-color` e `<link rel="manifest">` +
`apple-touch-icon` em `app/layout.tsx`.

`npm run build` + verificar no Chrome DevTools > Application > Manifest
que não há erro. Commit: `feat: manifest.json e icones para instalar o cardapio como PWA`

### Task I6: `context/AppContext.tsx` — memoizar o value do Provider

Achado de performance #3. Envolver o objeto passado a
`AppContext.Provider value={{...}}` em `useMemo`, com a lista de
dependências correta (`cart`, `currentStore`, `currentTable`,
`clientName`, `isHost`, e as funções — essas últimas precisam de
`useCallback` se quiserem entrar na lista de deps sem invalidar o memo
toda hora).

`npm run build`. Commit: `perf: memoiza o value do AppContext pra evitar re-render amplo no carrinho`

---

## Track D — Documentação (último passo, depois de tudo acima)

### Task D1: Atualizar `AGENTS.md`

**Files:** Modify `AGENTS.md`

1. Marcar como resolvidos os achados de segurança/bugs/performance/UX
   corrigidos nas tracks acima (referenciar as migrations novas
   007/008/009 na seção "Banco de dados").
2. Documentar como debito técnico **não resolvido por código** (só
   recomendação, porque exige acesso a um dashboard externo ou uma
   mudança arquitetural maior que não estava no escopo desta correção):
   - Upload preset do Cloudinary é público/não-assinado (achado de
     segurança #9) — recomendar checar/restringir no console da
     Cloudinary (fora do alcance de uma correção só de código, já que
     este projeto não tem backend pra assinar upload).
   - Ausência de estratégia de backup documentada (achado de segurança
     #12) — recomendar confirmar o plano de backup do Supabase em uso
     (PITR cobre Postgres; confirmar se cobre Storage também, onde
     ficam logo/fotos/certificado).
3. Registrar a decisão de soft-delete pra loja (Task A2.5) na seção de
   "Decisões de arquitetura".
4. Manter a seção "Backlog / Próximos passos" com as 15 ideias de
   produto da varredura, marcadas explicitamente como **standby / não
   iniciado** (ver lista completa abaixo) — não remover, só deixar claro
   que é trabalho futuro por decisão do usuário, não esquecimento.

`npm run build`. Commit: `docs: atualiza AGENTS.md com as correcoes da varredura e debito residual documentado`

---

## Novas features — STANDBY (não implementar agora, só registro)

Por instrução explícita do usuário (2026-07-02): "as novas features só
depois". Lista completa (já estava na varredura, repetida aqui só pra
o plano ficar autocontido):

1. Taxa de serviço configurável por loja (hoje fixa em 10%, só
   liga/desliga)
2. Exportar relatório em CSV
3. Comparação "vs. período anterior" no dashboard
4. Avaliação pós-refeição (estrelas + comentário)
5. Identidade do cliente por telefone/WhatsApp
6. Delivery/retirada com endereço e taxa de entrega
7. Cupom de desconto
8. Multi-idioma no cardápio (inclui a camada de i18n, achado de UX #12)
9. Notificação push real pro lojista (Service Worker + VAPID)
10. Programa de fidelidade (carimbo/pontos)
11. Dashboard cross-loja pro Master Admin
12. Campo de custo/margem por produto → CMV real
13. Reserva de mesa antecipada
14. Integração com o Norte Estoque (ntb-estoque) — baixa de ingrediente
    via ficha técnica
15. LGPD — exportação/exclusão de dados do cliente

---

## Resumo de arquivos tocados

- `supabase/migrations/007_seguranca_pedidos.sql` (novo)
- `supabase/migrations/008_seguranca_login.sql` (novo)
- `supabase/migrations/009_indices_realtime_e_soft_delete.sql` (novo)
- `lib/calc.ts` (novo)
- `lib/api.ts`
- `lib/print.ts`
- `components/modules/StoreModule.tsx`
- `components/modules/ClientModule.tsx`
- `components/ui.tsx`
- `components/Toast.tsx`
- `context/AppContext.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `public/manifest.json` (novo)
- `AGENTS.md`
