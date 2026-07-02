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
