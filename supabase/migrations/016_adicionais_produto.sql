-- Adicionais/opcionais de produto: grupo de opção (pertence a um produto)
-- e opção (pertence a um grupo). Dado não sensível (preço/nome de
-- adicional), RLS allow_all_anon igual ao padrão de 013_order_ratings.sql —
-- sem função security-definer pra CRUD, só create_order_secure (abaixo)
-- roda com privilégio elevado, porque é ali que o PREÇO final é calculado
-- a partir da escolha do cliente (mesmo princípio de price_at_time em
-- 007_seguranca_pedidos.sql).

create table if not exists product_option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  type text not null default 'single' check (type in ('single', 'multiple')),
  required boolean not null default false,
  "order" integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_product_option_groups_product_id on product_option_groups(product_id);

create table if not exists product_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references product_option_groups(id) on delete cascade,
  name text not null,
  price_delta numeric(10,2) not null default 0 check (price_delta >= 0),
  "order" integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_product_options_group_id on product_options(group_id);

alter table product_option_groups enable row level security;
drop policy if exists "allow_all_anon" on product_option_groups;
create policy "allow_all_anon" on product_option_groups
  for all to anon, authenticated using (true) with check (true);

alter table product_options enable row level security;
drop policy if exists "allow_all_anon" on product_options;
create policy "allow_all_anon" on product_options
  for all to anon, authenticated using (true) with check (true);

-- Snapshot histórico da escolha do cliente no momento do pedido — mesmo
-- princípio de price_at_time: NÃO é FK viva pra product_options, então
-- renomear/excluir uma opção depois não afeta pedido já feito.
-- Formato: [{name, price_delta}, ...].
alter table order_items add column if not exists selected_options jsonb not null default '[]'::jsonb;

-- ─── create_order_secure: agora também valida adicionais ──────────────────
-- p_items ganha um campo novo opcional `option_ids` (array de uuid) por
-- item. Mesmo princípio do preço base: o client manda só o ID da opção
-- escolhida, a function relê nome/price_delta em product_options e
-- confere que a opção pertence a um grupo do MESMO produto do item (nunca
-- de outro produto/loja) antes de somar ao preço. "required"/
-- obrigatoriedade de escolha NÃO é validado aqui — é regra de UX
-- (client-side), não de segurança de preço, consistente com o resto do
-- sistema (create_order_secure nunca validou regra de negócio não-
-- financeira, só integridade de preço).
create or replace function public.create_order_secure(
  p_table_id uuid,
  p_store_id uuid,
  p_order_type text,
  p_customer_name text,
  p_items jsonb -- [{product_id, quantity, notes, option_ids?: uuid[]}]
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
  v_option_ids uuid[];
  v_option_id uuid;
  v_option product_options%rowtype;
  v_options_delta numeric;
  v_selected_options jsonb;
begin
  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', 'Pedido sem itens.');
  end if;

  -- Pedido de mesa reaproveita um pedido 'pending' já aberto na mesma mesa
  -- (mesmo comportamento do insert direto que isso substitui) — sem isso,
  -- cada "enviar pedido" na mesma mesa vira uma linha nova em `orders`,
  -- inflando contagem de vendas/ticket médio no dashboard. Balcão sempre
  -- cria pedido novo (nunca teve essa reutilização).
  if p_order_type = 'table' and p_table_id is not null then
    select id into v_order_id from orders
    where table_id = p_table_id and status = 'pending'
    limit 1;
  end if;

  if v_order_id is null then
    insert into orders (table_id, store_id, status, order_type, total, customer_name)
    values (p_table_id, p_store_id, 'pending', p_order_type, 0, p_customer_name)
    returning id into v_order_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_product from products where id = (v_item->>'product_id')::uuid and store_id = p_store_id;
    if not found then
      raise exception 'Produto inválido para esta loja.';
    end if;
    if (v_item->>'quantity')::int <= 0 then
      raise exception 'Quantidade inválida.';
    end if;

    v_options_delta := 0;
    v_selected_options := '[]'::jsonb;

    select array(
      select (elem)::uuid
      from jsonb_array_elements_text(coalesce(v_item->'option_ids', '[]'::jsonb)) as elem
    ) into v_option_ids;

    foreach v_option_id in array v_option_ids
    loop
      select po.* into v_option
      from product_options po
      join product_option_groups pog on pog.id = po.group_id
      where po.id = v_option_id and pog.product_id = v_product.id;

      if not found then
        raise exception 'Opção inválida para este produto.';
      end if;

      v_options_delta := v_options_delta + v_option.price_delta;
      v_selected_options := v_selected_options || jsonb_build_object('name', v_option.name, 'price_delta', v_option.price_delta);
    end loop;

    v_line_total := (v_product.price + v_options_delta) * (v_item->>'quantity')::int;
    v_total := v_total + v_line_total;

    insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, selected_options)
    values (
      v_order_id, v_product.id, (v_item->>'quantity')::int, 'pending', v_item->>'notes',
      v_product.price + v_options_delta, v_selected_options
    );
  end loop;

  -- Soma ao total existente (não sobrescreve) — o pedido pode já ter itens
  -- de uma chamada anterior, se foi reaproveitado acima.
  update orders set total = total + v_total where id = v_order_id;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end;
$$;

grant execute on function public.create_order_secure(uuid, uuid, text, text, jsonb) to anon, authenticated;
