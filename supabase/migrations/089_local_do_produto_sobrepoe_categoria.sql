-- Produto pode escolher Cozinha/Bar mesmo numa categoria que vai pra outro
-- local (ex.: categoria Pizzaria, mas este item vai pra Cozinha).
alter table products add column if not exists ignore_category_sector boolean not null default false;

create or replace function public.set_product_sector_secure(p_product_id uuid, p_store_id uuid, p_sector_id uuid, p_ignore_category boolean default false)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $$
  update products set sector_id = p_sector_id, ignore_category_sector = coalesce(p_ignore_category, false)
  where id = p_product_id and store_id = p_store_id;
$$;
grant execute on function public.set_product_sector_secure(uuid, uuid, uuid, boolean) to anon, authenticated;
drop function if exists public.set_product_sector_secure(uuid, uuid, uuid);

create or replace function public.fetch_kitchen_orders_secure(p_store_id uuid, p_destination text default 'kitchen')
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select oi.*, to_jsonb(p) as product,
      x.setor as sector_id,
      jsonb_build_object('id', o.id, 'order_type', o.order_type, 'table_id', o.table_id,
        'tables', (select to_jsonb(tb) from tables tb where tb.id = o.table_id)) as "order"
    from order_items oi
    join products p on p.id = oi.product_id and p.store_id = p_store_id
    join orders o on o.id = oi.order_id
    cross join lateral (
      select coalesce(p.sector_id, case when p.ignore_category_sector then null else (select c.sector_id from categories c where c.id = p.category_id) end) as setor
    ) x
    where oi.status not in ('delivered', 'canceled')
      and coalesce((select s.base from print_sectors s where s.id = x.setor), p.destination, 'kitchen') = p_destination
      and not (o.order_type = 'counter' and oi.status = 'pending')
    order by oi.created_at
    limit 500
  ) t;
$function$;

notify pgrst, 'reload schema';
