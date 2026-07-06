-- Vende mais II (2026-07-06): mais vendido automatico, peca tambem
-- (cross-sell manual do lojista) e favoritos (100% client-side, sem
-- schema nenhum, nao entra nesta migration).

-- ─── Mais vendido: RPC de leitura agregada, nunca expoe dado bruto ────────
-- order_items/orders nao tem select liberado pro anon (dado de venda e'
-- sensivel — concorrente nao pode raspar quantidade/receita). Esta
-- function devolve so' uma lista ordenada de product_id, security definer
-- pra rodar com privilegio de dono (bypassa RLS) sem abrir select direto
-- nas tabelas de pedido pro client.
create index if not exists idx_order_items_store_product on order_items(store_id, product_id);

create or replace function public.get_bestseller_product_ids(
  p_store_id uuid,
  p_days int default 30,
  p_limit int default 5
) returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(product_id order by total_qty desc), '{}'::uuid[])
  from (
    select oi.product_id, sum(oi.quantity) as total_qty
    from order_items oi
    join orders o on o.id = oi.order_id
    where oi.store_id = p_store_id
      and oi.product_id is not null -- produto excluido (on delete set null) nao pode "vender mais"
      and o.created_at > now() - (greatest(p_days, 1) || ' days')::interval
      and o.status != 'canceled'
    group by oi.product_id
    order by total_qty desc
    limit greatest(p_limit, 1)
  ) top;
$$;

grant execute on function public.get_bestseller_product_ids(uuid, int, int) to anon, authenticated;

-- Toggle do lojista (sem coluna nova): stores.config.show_bestsellers
-- (jsonb ja existente, mesmo padrao de charge_service_fee/note_suggestions).

-- ─── Peca tambem: tabela + RPC atomica ─────────────────────────────────────
create table if not exists product_recommendations (
  product_id uuid not null references products(id) on delete cascade,
  recommended_product_id uuid not null references products(id) on delete cascade,
  position int not null default 0,
  primary key (product_id, recommended_product_id),
  check (product_id != recommended_product_id)
);

alter table product_recommendations enable row level security;

drop policy if exists select_anon_product_recommendations on product_recommendations;
create policy select_anon_product_recommendations on product_recommendations
  for select using (true);
-- Sem policy de insert/update/delete pro anon de proposito: toda escrita
-- passa pela RPC abaixo (mesmo padrao de sync_product_option_groups),
-- que roda como dono da function (bypassa RLS) depois de validar loja.

create or replace function public.sync_product_recommendations(
  p_product_id uuid,
  p_store_id uuid,
  p_recommended_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_count int;
begin
  if not exists (select 1 from products where id = p_product_id and store_id = p_store_id) then
    raise exception 'Produto inválido para esta loja.';
  end if;

  select array(select distinct unnest(coalesce(p_recommended_ids, '{}'::uuid[]))) into v_ids;

  if coalesce(array_length(v_ids, 1), 0) > 3 then
    raise exception 'No máximo 3 produtos recomendados.';
  end if;

  select count(*) into v_count
  from products
  where id = any(v_ids) and store_id = p_store_id and id != p_product_id;

  if v_count != coalesce(array_length(v_ids, 1), 0) then
    raise exception 'Produto recomendado inválido para esta loja.';
  end if;

  delete from product_recommendations where product_id = p_product_id;

  if array_length(v_ids, 1) > 0 then
    insert into product_recommendations (product_id, recommended_product_id, position)
    select p_product_id, rid, ord - 1
    from unnest(v_ids) with ordinality as t(rid, ord);
  end if;
end;
$$;

grant execute on function public.sync_product_recommendations(uuid, uuid, uuid[]) to anon, authenticated;
