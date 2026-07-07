-- Fecha RLS orders/order_items/products (fase 1: RPCs novas, aditivo)
-- Ver docs/plans/2026-07-07-fecha-rls-orders-products-plan.md pro contexto completo.

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
        from order_items oi left join products p on p.id = oi.product_id
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
        from order_items oi left join products p on p.id = oi.product_id
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
        from order_items oi left join products p on p.id = oi.product_id
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



-- Achados adicionais durante a migracao do lib/api.ts (nao previstos no
-- plano original): mais 3 pontos de escrita direta em orders/products que
-- so' apareceram ao mapear TODO o arquivo, nao so' os 15 citados no plano.

-- Master Admin: apaga historico de vendas de uma loja (Historico > Limpar).
create or replace function public.clear_sales_history_secure(p_store_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from orders where store_id = p_store_id;
end;
$$;
grant execute on function public.clear_sales_history_secure(uuid) to anon, authenticated;

-- Cancela itens pendentes/aceitos de uma mesa (usado ao mover/cancelar mesa).
create or replace function public.cancel_pending_table_items_secure(p_table_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update order_items set status = 'canceled'
  where order_id in (select id from orders where table_id = p_table_id and status != 'delivered')
    and status in ('pending', 'accepted');
end;
$$;
grant execute on function public.cancel_pending_table_items_secure(uuid) to anon, authenticated;

-- Master Admin: duplicar loja (duplicateStore em lib/api.ts) insere produtos
-- em lote pra loja nova clonada.
create or replace function public.duplicate_products_secure(p_store_id uuid, p_products jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into products (store_id, category_id, name, description, price, image_url, available, prep_time_minutes)
  select p_store_id, (elem->>'category_id')::uuid, elem->>'name', elem->>'description',
    (elem->>'price')::numeric, elem->>'image_url', (elem->>'available')::boolean, (elem->>'prep_time_minutes')::int
  from jsonb_array_elements(p_products) as elem;
end;
$$;
grant execute on function public.duplicate_products_secure(uuid, jsonb) to anon, authenticated;
