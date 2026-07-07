# Fecha RLS de orders/order_items/products — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fechar um achado crítico real, confirmado ao vivo com a chave anônima
pública (2026-07-07, varredura de segurança): a policy `allow_all_anon` de
`001_schema_inicial.sql` cobre `orders`/`order_items` com `SELECT`+`INSERT`
liberados e `products` com `UPDATE`+`INSERT`+`DELETE` liberados pra qualquer
um com a chave anônima do app (a mesma hardcoded no bundle do client).
Confirmado na prática: consegui ler pedidos reais (nome de cliente, forma de
pagamento) de qualquer loja da plataforma sem login nenhum, e mudar o preço
de um produto real de R$0,75 pra R$0,01 com uma única chamada REST.

**Por que não é um patch de 5 minutos:** este app não usa Supabase Auth — não
existe JWT/sessão real vinculada a `store_users`, então a única coisa que
hoje distingue "cliente legítimo da loja X" de "qualquer um" é o app nunca
mandar um `store_id`/`order_id` que o usuário não devesse ter — ou seja,
`store_id` já É o limite de confiança usado em todo o resto do app (é assim
que `fetchKitchenOrders(storeId)` sempre funcionou, por exemplo). O achado
real não é "falta autenticação real" (isso seria uma reforma grande demais
pra agora) — é que hoje dá pra pular esse limite TOTALMENTE: ler a tabela
inteira sem filtro nenhum de loja, e escrever em `products`/`orders`/
`order_items` com um payload arbitrário (qualquer coluna, incluindo preço)
em vez de passar pelas RPCs que já validam regra de negócio
(`create_order_secure`, etc.). A correção é forçar TODO acesso a passar por
RPC com formato fixo — mesmo padrão já usado em `store_users`/`system_admins`
desde a migration 014.

**Ordem de execução, deliberadamente em 2 fases pra nunca deixar a loja real
fora do ar**:
1. **M1 (aditivo, seguro)**: cria todas as RPCs novas. Não revoga nada ainda
   — o caminho antigo (inseguro) continua funcionando em paralelo.
2. **A1**: migra todo `lib/api.ts` pra chamar as RPCs novas em vez de
   `.from(...).insert/update/delete/select` direto.
3. **Teste completo**: `npx tsc --noEmit`, `npm run build`, teste manual ao
   vivo na Bistrô Demo (pedido de balcão, KDS, fechar mesa, editar produto,
   histórico de vendas) — confirmar que TUDO que usava o caminho antigo
   continua funcionando através da RPC nova.
4. **M2 (o corte, só depois do passo 3 confirmado)**: `REVOKE` de
   `SELECT`/`INSERT`/`UPDATE`/`DELETE` de `anon`/`authenticated` nas 3
   tabelas (mantém só o que precisa continuar público: `SELECT` em
   `products`/`categories` pro cardápio funcionar).
5. **Verificação final**: repetir o teste que encontrou o achado (ler
   `order_items` e tentar `UPDATE` em `products` com só a anon key) e
   confirmar que agora falha.

**Tech Stack:** igual ao resto — Next.js 16, Supabase, `npm run build` como
rede de segurança, `node scripts/db.mjs` pra testar RPC direto antes de
mexer no client.

---

## Task M1: Migration `021_fecha_rls_orders_products.sql` (RPCs novas, aditivo)

**Files:** Create `supabase/migrations/021_fecha_rls_orders_products.sql`

### RPCs de escrita em `products`

```sql
create or replace function public.create_product_secure(
  p_store_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_image_url text,
  p_prep_time_minutes int,
  p_destination text,
  p_promo_price numeric default null,
  p_featured boolean default false,
  p_tags text[] default '{}'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_order int;
  v_id uuid;
begin
  select coalesce(max("order"), 0) + 1 into v_next_order from products where category_id = p_category_id;

  insert into products (store_id, category_id, name, description, price, image_url, prep_time_minutes, available, "order", destination, promo_price, featured, tags)
  values (p_store_id, p_category_id, p_name, p_description, p_price, p_image_url, p_prep_time_minutes, true, v_next_order, coalesce(p_destination, 'kitchen'), p_promo_price, p_featured, coalesce(p_tags, '{}'))
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.create_product_secure(uuid, uuid, text, text, numeric, text, int, text, numeric, boolean, text[]) to anon, authenticated;

-- update_product_secure: parametros nullable = "nao mudar esse campo" (nao
-- da pra distinguir NULL de "nao enviado" numa RPC com params nomeados, mas
-- nenhum desses campos e' legitimamente setado pra NULL pelo client hoje,
-- exceto promo_price -- por isso um flag separado p_clear_promo_price).
create or replace function public.update_product_secure(
  p_product_id uuid,
  p_store_id uuid,
  p_name text default null,
  p_description text default null,
  p_price numeric default null,
  p_category_id uuid default null,
  p_image_url text default null,
  p_prep_time_minutes int default null,
  p_destination text default null,
  p_available boolean default null,
  p_promo_price numeric default null,
  p_clear_promo_price boolean default false,
  p_featured boolean default null,
  p_tags text[] default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from products where id = p_product_id and store_id = p_store_id) then
    raise exception 'Produto inválido para esta loja.';
  end if;

  update products set
    name = coalesce(p_name, name),
    description = coalesce(p_description, description),
    price = coalesce(p_price, price),
    category_id = coalesce(p_category_id, category_id),
    image_url = coalesce(p_image_url, image_url),
    prep_time_minutes = coalesce(p_prep_time_minutes, prep_time_minutes),
    destination = coalesce(p_destination, destination),
    available = coalesce(p_available, available),
    promo_price = case when p_clear_promo_price then null else coalesce(p_promo_price, promo_price) end,
    featured = coalesce(p_featured, featured),
    tags = coalesce(p_tags, tags)
  where id = p_product_id and store_id = p_store_id;
end;
$$;
grant execute on function public.update_product_secure(uuid, uuid, text, text, numeric, uuid, text, int, text, boolean, numeric, boolean, boolean, text[]) to anon, authenticated;

create or replace function public.delete_product_secure(p_product_id uuid, p_store_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from products where id = p_product_id and store_id = p_store_id;
end;
$$;
grant execute on function public.delete_product_secure(uuid, uuid) to anon, authenticated;
```

### RPCs de escrita em `orders`/`order_items`

```sql
create or replace function public.update_order_status_secure(p_order_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update orders set status = p_status, updated_at = now() where id = p_order_id;
end;
$$;
grant execute on function public.update_order_status_secure(uuid, text) to anon, authenticated;

create or replace function public.send_order_to_kitchen_secure(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update orders set status = 'accepted', updated_at = now() where id = p_order_id;
  update order_items set status = 'accepted' where order_id = p_order_id;
end;
$$;
grant execute on function public.send_order_to_kitchen_secure(uuid) to anon, authenticated;

create or replace function public.close_counter_order_secure(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update orders set status = 'delivered', updated_at = now() where id = p_order_id;
  update order_items set status = 'delivered' where order_id = p_order_id;
end;
$$;
grant execute on function public.close_counter_order_secure(uuid) to anon, authenticated;

create or replace function public.update_order_item_status_secure(p_item_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update order_items set status = p_status where id = p_item_id;
end;
$$;
grant execute on function public.update_order_item_status_secure(uuid, text) to anon, authenticated;

create or replace function public.cancel_order_item_secure(p_item_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update order_items set status = 'canceled' where id = p_item_id;
end;
$$;
grant execute on function public.cancel_order_item_secure(uuid) to anon, authenticated;

-- Fecha todos os pedidos abertos de uma mesa (usado ao fechar conta/mover
-- mesa) -- substitui o bloco de closeTableSession em lib/api.ts que fazia
-- select+update em orders, update em order_items e update em tables, tudo
-- direto. p_payment_method/p_payment_details ficam nullable (fechamento sem
-- registrar pagamento detalhado continua possivel).
create or replace function public.close_table_orders_secure(
  p_table_id uuid,
  p_payment_method text default null,
  p_payment_details jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update orders set
    status = 'delivered',
    payment_method = coalesce(p_payment_method, payment_method),
    payment_details = coalesce(p_payment_details, payment_details),
    updated_at = now()
  where table_id = p_table_id and status not in ('delivered', 'canceled');

  update order_items set status = 'delivered'
  where order_id in (select id from orders where table_id = p_table_id)
    and status != 'canceled';
end;
$$;
grant execute on function public.close_table_orders_secure(uuid, text, jsonb) to anon, authenticated;
```

### RPCs de leitura em `orders`/`order_items` (devolvem o mesmo formato JSON que o `.select()` aninhado já devolvia, pra não precisar mudar o resto do código que consome o retorno)

```sql
create or replace function public.fetch_order_by_id_secure(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(o) from orders o where o.id = p_order_id;
$$;
grant execute on function public.fetch_order_by_id_secure(uuid) to anon, authenticated;

create or replace function public.fetch_active_table_orders_secure(p_store_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select o.*,
      (select coalesce(jsonb_agg(oi_row), '[]'::jsonb) from (
        select oi.*, to_jsonb(p) as product
        from order_items oi join products p on p.id = oi.product_id
        where oi.order_id = o.id
      ) oi_row) as order_items
    from orders o
    where o.store_id = p_store_id and o.order_type = 'table'
      and o.status not in ('delivered', 'canceled')
    order by o.created_at
    limit 500
  ) t;
$$;
grant execute on function public.fetch_active_table_orders_secure(uuid) to anon, authenticated;

create or replace function public.fetch_table_order_summary_secure(p_table_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', coalesce(sum(oi.price_at_time * oi.quantity) filter (where oi.status != 'canceled'), 0),
    'items', coalesce(jsonb_agg(to_jsonb(oi)) filter (where oi.status != 'canceled'), '[]'::jsonb)
  )
  from orders o join order_items oi on oi.order_id = o.id
  where o.table_id = p_table_id and o.status not in ('delivered', 'canceled');
$$;
grant execute on function public.fetch_table_order_summary_secure(uuid) to anon, authenticated;

create or replace function public.fetch_kitchen_orders_secure(p_store_id uuid, p_destination text default 'kitchen') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select oi.*, to_jsonb(p) as product,
      jsonb_build_object('id', o.id, 'order_type', o.order_type, 'table_id', o.table_id,
        'tables', (select to_jsonb(tb) from tables tb where tb.id = o.table_id)) as "order"
    from order_items oi
    join products p on p.id = oi.product_id and p.store_id = p_store_id
    join orders o on o.id = oi.order_id
    where oi.status not in ('delivered', 'canceled')
      and coalesce(p.destination, 'kitchen') = p_destination
      and not (o.order_type = 'counter' and oi.status = 'pending')
    order by oi.created_at
    limit 500
  ) t;
$$;
grant execute on function public.fetch_kitchen_orders_secure(uuid, text) to anon, authenticated;

create or replace function public.fetch_counter_orders_secure(p_store_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select o.*,
      (select coalesce(jsonb_agg(oi_row), '[]'::jsonb) from (
        select oi.*, to_jsonb(p) as product
        from order_items oi join products p on p.id = oi.product_id
        where oi.order_id = o.id
      ) oi_row) as order_items
    from orders o
    where o.store_id = p_store_id and o.order_type = 'counter' and o.status != 'delivered'
    order by o.created_at desc
    limit 500
  ) t;
$$;
grant execute on function public.fetch_counter_orders_secure(uuid) to anon, authenticated;

create or replace function public.fetch_sales_history_secure(p_store_id uuid, p_start_date timestamptz default null, p_end_date timestamptz default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select o.*,
      (select coalesce(jsonb_agg(oi_row), '[]'::jsonb) from (
        select oi.*, to_jsonb(p) as product
        from order_items oi join products p on p.id = oi.product_id
        where oi.order_id = o.id
      ) oi_row) as order_items,
      (select to_jsonb(tb) from tables tb where tb.id = o.table_id) as tables
    from orders o
    where o.store_id = p_store_id and o.status = 'delivered'
      and (p_start_date is null or o.created_at >= p_start_date)
      and (p_end_date is null or o.created_at <= p_end_date)
    order by o.created_at desc
    limit 2000
  ) t;
$$;
grant execute on function public.fetch_sales_history_secure(uuid, timestamptz, timestamptz) to anon, authenticated;
```

**Step 2:** Aplicar via `node scripts/aplicar-migration.mjs 021_fecha_rls_orders_products.sql`.
**Step 3:** Testar cada RPC individualmente via `node scripts/db.mjs "select ..."` contra a Bistrô Demo (dado real que já existe, sem criar/apagar nada) antes de tocar no client — comparar o JSON devolvido com o formato que o `.select()` aninhado equivalente já devolvia.
**Step 4:** Commit: `feat: RPCs security definer pra escrita/leitura de orders/order_items/products (fecha RLS aberta)`

---

## Task A1: Migrar `lib/api.ts` pra usar as RPCs novas

Trocar cada chamada direta listada abaixo pela RPC equivalente, mantendo a
MESMA assinatura de função exportada (mesmo nome, mesmos parâmetros, mesmo
tipo de retorno) — só a implementação interna muda, pra não precisar tocar
em `StoreModule.tsx`/`ClientModule.tsx` nenhuma vez:

- `createProduct` → `create_product_secure`
- `updateProduct` → `update_product_secure`
- `deleteProduct` → `delete_product_secure`
- `updateOrderStatus` → `update_order_status_secure`
- `sendOrderToKitchen` → `send_order_to_kitchen_secure`
- `closeCounterOrder` → `close_counter_order_secure`
- `updateOrderItemStatus` → `update_order_item_status_secure`
- `cancelSpecificOrderItem` → `cancel_order_item_secure`
- `closeTableSession` (a função que hoje faz o bloco de select+update em
  orders/order_items/tables) → chama `close_table_orders_secure` pra
  orders/order_items, mas continua fazendo o `.from('tables').update(...)`
  direto (RLS de `tables` está fora do escopo desta correção — ver "Fora de
  escopo" abaixo).
- `fetchOrderById` → `fetch_order_by_id_secure`, unwrap do jsonb pro shape
  `Order` esperado (`data ?? null`, sem precisar de `.single()`).
- `fetchActiveOrdersForTables` → `fetch_active_table_orders_secure`
- `fetchTableOrderSummary` → `fetch_table_order_summary_secure`
- `fetchKitchenOrders` → `fetch_kitchen_orders_secure`
- `fetchCounterOrders` → `fetch_counter_orders_secure`
- `fetchSalesHistory` → `fetch_sales_history_secure`

Manter o mesmo tratamento de erro (`console.error` + array vazio nas
funções de leitura, `throw` nas de escrita) já usado hoje em cada uma.

**Não mexer** em `createOrder` (já usa `create_order_secure`, RPC
pré-existente, fora do escopo) nem em `duplicateStore`/scripts de seed que
inserem em lote (`products`, `categories`) — são operações de Master Admin,
menor prioridade, ver "Fora de escopo".

**Step 2:** `npx tsc --noEmit -p tsconfig.json`. **Step 3:** Commit:
`feat: migra lib/api.ts pras RPCs seguras de orders/order_items/products`

---

## Task T1: Teste completo antes do corte

`npm run build` limpo. Depois, teste manual ao vivo na **Bistrô Demo**
(nunca em loja real de cliente):
1. Balcão: abrir comanda, pedir 1 item, confirmar total certo.
2. Lojista: ver o pedido aparecer no KDS, marcar "iniciar preparo", marcar
   pronto, fechar/entregar.
3. Mesa: abrir mesa, pedir, fechar conta com pagamento, confirmar que a
   mesa volta pra "disponível" com PIN novo.
4. Lojista: editar um produto (nome, preço, promo, tag, disponibilidade),
   confirmar que salva e reflete no cardápio do cliente.
5. Lojista: criar produto novo, depois excluir.
6. Lojista: abrir Histórico de Vendas, confirmar que os pedidos aparecem
   certos (valor, itens).

Só prosseguir pro Task M2 se **todos** os 6 passarem sem erro.

---

## Task M2: Migration `022_revoga_anon_orders_products.sql` (o corte)

**Só aplicar depois do Task T1 confirmado.**

```sql
-- Fecha o achado critico: allow_all_anon (migration 001) cobria SELECT
-- aberto em orders/order_items (vazamento de nome/pagamento de cliente de
-- qualquer loja) e INSERT/UPDATE/DELETE aberto em orders/order_items/
-- products (preco adulteravel direto via REST, sem passar por
-- create_order_secure/update_product_secure). Todo acesso real ja migrou
-- pras RPCs security definer da migration 021 -- este e' so o corte do
-- caminho antigo.

drop policy if exists allow_all_anon on orders;
drop policy if exists allow_all_anon on order_items;
-- products continua com SELECT publico (cardapio tem que ser legivel sem
-- login), so perde INSERT/UPDATE/DELETE direto.
drop policy if exists allow_all_anon on products;

create policy select_orders_none on orders for select using (false);
create policy select_order_items_none on order_items for select using (false);
create policy select_products_anon on products for select using (true);
```

**Step 2:** Aplicar. **Step 3 (verificação final, obrigatória)**: repetir
exatamente o teste que encontrou o achado — com `@supabase/supabase-js` e
só a anon key pública, tentar `select * from order_items limit 1` (deve
devolver 0 linhas ou erro de RLS) e tentar `update products set price = ...`
num produto real (deve falhar). Testar também que o app continua
funcionando normal na Bistrô Demo (repetir os 6 passos do Task T1).
**Step 4:** Commit: `fix: revoga select/insert/update/delete anonimo em orders/order_items/products (achado critico de seguranca)`

---

## Task D1: Atualizar `AGENTS.md`

Documentar o achado, a correção em 2 fases, e a nova lista de RPCs — numa
seção nova, "Correção de segurança crítica (2026-07-07)", citando que foi
encontrado numa varredura e confirmado ao vivo com a anon key (sem revelar
detalhes desnecessários, só o suficiente pra quem ler entender o que mudou
e por quê). Atualizar a lista de migrations (021, 022).

Commit: `docs: documenta correcao critica de RLS em orders/order_items/products`

---

## Fora de escopo (registrar, não fazer agora)

- `tables`/`table_sessions` têm a mesma `allow_all_anon` aberta
  (`waiter_requested`, `service_fee_removed`, `pin`, `current_host_name`) —
  menor severidade (sem PII, sem valor financeiro direto, embora mudar o
  PIN de alguém seja chato), mas é a mesma classe de achado. Próxima rodada.
- `duplicateStore` (Master Admin) e scripts de seed que fazem insert em
  lote de `products`/`categories` continuam usando acesso direto — são
  ferramentas internas de admin, não expostas a cliente anônimo comum, e o
  Master Admin já não tem sessão real verificável de qualquer forma (mesmo
  problema de fundo, mas menor exposição prática).
- Autenticação real (Supabase Auth/JWT por `store_user`) resolveria isso na
  raiz, mas é uma reforma grande — não é o escopo desta correção pontual.
