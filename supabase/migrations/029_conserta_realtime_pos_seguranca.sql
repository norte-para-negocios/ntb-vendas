-- Achado urgente (2026-07-07, testando na pratica): a correcao critica de
-- seguranca (021/022) fechou o SELECT publico de orders/order_items -- mas o
-- Supabase Realtime SO entrega postgres_changes pra quem tem visibilidade via
-- RLS na tabela. Resultado: TODA a UI em tempo real do lojista (mesa,
-- cozinha/bar, balcao, notificacoes) e o acompanhamento de pedido do cliente
-- (OrderTracker) pararam de atualizar sozinhos -- so' com F5 manual.
--
-- Pior ainda: 2 chamadas diretas em ClientModule.tsx (`.from('order_items')`,
-- linhas ~137/156, dentro do OrderTracker) nunca foram migradas pra RPC
-- segura na correcao original -- ficaram retornando vazio desde entao (nao
-- e' so' o realtime, e' o fetch inicial tambem). Corrigido junto: nova RPC
-- `fetch_order_items_secure`.
--
-- Fix pro realtime: tabela de "ping" sem NENHUM dado sensivel (so' order_id +
-- store_id + timestamp) que um trigger mantem atualizada a cada mudanca em
-- orders/order_items. Ela pode ficar com select publico sem problema nenhum
-- de seguranca -- nao revela nome de cliente, valor, status, nada -- so' "algo
-- mudou nesse pedido/loja, hora X". O client assina ESSA tabela e, ao receber
-- um ping, busca o dado de verdade pela RPC segura (fetch_order_by_id_secure,
-- fetch_order_items_secure, ou as RPCs de listagem ja existentes).

create table if not exists order_change_pings (
  order_id uuid primary key,
  store_id uuid not null,
  changed_at timestamptz not null default now()
);
create index if not exists idx_order_change_pings_store on order_change_pings(store_id);

alter table order_change_pings enable row level security;
drop policy if exists "allow_all_anon" on order_change_pings;
create policy "allow_all_anon" on order_change_pings
  for select to anon, authenticated using (true);

create or replace function public.ping_order_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid;
  v_store_id uuid;
begin
  if tg_table_name = 'orders' then
    v_order_id := coalesce(new.id, old.id);
    v_store_id := coalesce(new.store_id, old.store_id);
  else
    v_order_id := coalesce(new.order_id, old.order_id);
    v_store_id := coalesce(new.store_id, old.store_id);
  end if;

  insert into order_change_pings (order_id, store_id, changed_at)
  values (v_order_id, v_store_id, now())
  on conflict (order_id) do update set changed_at = excluded.changed_at, store_id = excluded.store_id;

  return null;
end;
$$;

drop trigger if exists trg_ping_orders on orders;
create trigger trg_ping_orders after insert or update or delete on orders
  for each row execute function public.ping_order_change();

drop trigger if exists trg_ping_order_items on order_items;
create trigger trg_ping_order_items after insert or update or delete on order_items
  for each row execute function public.ping_order_change();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'order_change_pings') then
    alter publication supabase_realtime add table order_change_pings;
  end if;
end $$;

-- Segundo achado: OrderTracker (ClientModule.tsx) buscava order_items direto
-- via supabase.from(), sem passar pela camada de RPC segura -- desde 022
-- retornava sempre vazio (RLS bloqueando), o cliente nunca via os itens do
-- proprio pedido apos finalizar a compra.
create or replace function public.fetch_order_items_secure(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select oi.*, to_jsonb(p) as product
    from order_items oi left join products p on p.id = oi.product_id
    where oi.order_id = p_order_id
  ) t;
$$;
grant execute on function public.fetch_order_items_secure(uuid) to anon, authenticated;
