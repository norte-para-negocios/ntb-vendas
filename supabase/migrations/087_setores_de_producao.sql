-- Setores de produção personalizáveis (ex.: Pizzaria), além de Cozinha/Bar.
-- Setor do item = produto.sector_id ?? categoria.sector_id ?? padrão (sem setor).
-- Impressora com sector_id só imprime itens daquele setor; impressora sem
-- setor (como sempre foi) só imprime itens SEM setor do destino dela.
-- `base` diz em qual fluxo o setor entra (kitchen/bar) pro KDS e a fila.
create table if not exists print_sectors (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  base text not null default 'kitchen' check (base in ('kitchen','bar')),
  created_at timestamptz not null default now()
);
create index if not exists idx_print_sectors_store on print_sectors(store_id);
alter table print_sectors enable row level security;
drop policy if exists "allow_all_anon" on print_sectors;
create policy "allow_all_anon" on print_sectors for all to anon, authenticated using (true) with check (true);

alter table products add column if not exists sector_id uuid references print_sectors(id) on delete set null;
alter table categories add column if not exists sector_id uuid references print_sectors(id) on delete set null;
alter table printer_configs add column if not exists sector_id uuid references print_sectors(id) on delete set null;

create or replace function public.fetch_kitchen_orders_secure(p_store_id uuid, p_destination text default 'kitchen')
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select oi.*, to_jsonb(p) as product,
      coalesce(p.sector_id, (select c.sector_id from categories c where c.id = p.category_id)) as sector_id,
      jsonb_build_object('id', o.id, 'order_type', o.order_type, 'table_id', o.table_id,
        'tables', (select to_jsonb(tb) from tables tb where tb.id = o.table_id)) as "order"
    from order_items oi
    join products p on p.id = oi.product_id and p.store_id = p_store_id
    join orders o on o.id = oi.order_id
    where oi.status not in ('delivered', 'canceled')
      and coalesce((select s.base from print_sectors s where s.id = coalesce(p.sector_id, (select c.sector_id from categories c where c.id = p.category_id))), p.destination, 'kitchen') = p_destination
      and not (o.order_type = 'counter' and oi.status = 'pending')
    order by oi.created_at
    limit 500
  ) t;
$function$;

notify pgrst, 'reload schema';
