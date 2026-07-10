-- Fase 1 de melhorias (varredura 2026-07-09): fecha o mesmo tipo de achado
-- critico ja corrigido em orders/order_items/products (migrations 021/022) --
-- agora para tables/table_sessions. Hoje a policy allow_all_anon
-- (001_schema_inicial.sql / 004_table_sessions.sql) permite SELECT/UPDATE/
-- INSERT/DELETE sem filtro nenhum com a anon key publica: da pra ler o pin
-- em texto puro de qualquer mesa de qualquer loja da plataforma. Ver
-- docs/superpowers/specs/2026-07-09-fase1-seguranca-mesa-design.md.
--
-- Antes de fechar a RLS (proxima migration), esta cria as RPCs security
-- definer que substituem todo acesso direto e a tabela de ping que evita
-- quebrar o Realtime -- mesmo problema que ja aconteceu com orders/
-- order_items em 07/07 (corrigido na migration 029): postgres_changes so'
-- entrega evento pra quem tem visibilidade via RLS na tabela.

create table if not exists table_change_pings (
  table_id uuid primary key,
  store_id uuid not null,
  changed_at timestamptz not null default now()
);
create index if not exists idx_table_change_pings_store on table_change_pings(store_id);

alter table table_change_pings enable row level security;
drop policy if exists "allow_all_anon" on table_change_pings;
create policy "allow_all_anon" on table_change_pings
  for select to anon, authenticated using (true);

create or replace function public.ping_table_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_table_id uuid;
  v_store_id uuid;
begin
  v_table_id := coalesce(new.id, old.id);
  v_store_id := coalesce(new.store_id, old.store_id);

  insert into table_change_pings (table_id, store_id, changed_at)
  values (v_table_id, v_store_id, now())
  on conflict (table_id) do update set changed_at = excluded.changed_at, store_id = excluded.store_id;

  return null;
end;
$$;

drop trigger if exists trg_ping_tables on tables;
create trigger trg_ping_tables after insert or update or delete on tables
  for each row execute function public.ping_table_change();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'table_change_pings') then
    alter publication supabase_realtime add table table_change_pings;
  end if;
end $$;

-- RPCs de leitura. get_tables_secure inclui `pin` (uso do lojista/admin,
-- mesmo dado que fetchTables ja devolvia). get_tables_public_secure e
-- get_table_public_by_id_secure NUNCA incluem `pin` (uso do cliente final).
create or replace function public.get_tables_secure(p_store_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.number), '[]'::jsonb)
  from tables t where t.store_id = p_store_id;
$$;
grant execute on function public.get_tables_secure(uuid) to anon, authenticated;

create or replace function public.get_tables_public_secure(p_store_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.number), '[]'::jsonb)
  from (
    select id, store_id, number, status, current_host_name, guest_count, waiter_requested, service_fee_removed
    from tables where store_id = p_store_id
  ) t;
$$;
grant execute on function public.get_tables_public_secure(uuid) to anon, authenticated;

create or replace function public.get_table_public_by_id_secure(p_table_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(t) from (
    select id, store_id, number, status, current_host_name, guest_count, waiter_requested, service_fee_removed
    from tables where id = p_table_id
  ) t;
$$;
grant execute on function public.get_table_public_by_id_secure(uuid) to anon, authenticated;

create or replace function public.fetch_table_sessions_secure(p_store_id uuid, p_since_date timestamptz default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.opened_at desc), '[]'::jsonb)
  from (
    select * from table_sessions
    where store_id = p_store_id
      and closed_at is not null
      and (p_since_date is null or opened_at >= p_since_date)
    order by opened_at desc
    limit 2000
  ) t;
$$;
grant execute on function public.fetch_table_sessions_secure(uuid, timestamptz) to anon, authenticated;

create or replace function public.request_waiter_secure(p_table_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update tables set waiter_requested = true where id = p_table_id;
end;
$$;
grant execute on function public.request_waiter_secure(uuid) to anon, authenticated;

create or replace function public.cancel_waiter_request_secure(p_table_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update tables set waiter_requested = false where id = p_table_id;
end;
$$;
grant execute on function public.cancel_waiter_request_secure(uuid) to anon, authenticated;

create or replace function public.toggle_service_fee_secure(p_table_id uuid, p_removed boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update tables set service_fee_removed = p_removed where id = p_table_id;
end;
$$;
grant execute on function public.toggle_service_fee_secure(uuid, boolean) to anon, authenticated;

create or replace function public.toggle_table_block_secure(p_table_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_current text;
begin
  select status into v_current from tables where id = p_table_id;
  if v_current = 'blocked' then
    update tables set status = 'available' where id = p_table_id;
  else
    update tables set status = 'blocked' where id = p_table_id;
  end if;
end;
$$;
grant execute on function public.toggle_table_block_secure(uuid) to anon, authenticated;

create or replace function public.request_table_bill_secure(p_table_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update tables set status = 'waiting_bill' where id = p_table_id;
end;
$$;
grant execute on function public.request_table_bill_secure(uuid) to anon, authenticated;

create or replace function public.open_table_manually_secure(p_table_id uuid, p_store_id uuid, p_host_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update tables set status = 'occupied', current_host_name = p_host_name where id = p_table_id;
  insert into table_sessions (table_id, store_id, host_name) values (p_table_id, p_store_id, p_host_name);
end;
$$;
grant execute on function public.open_table_manually_secure(uuid, uuid, text) to anon, authenticated;

-- Corrige bug real descoberto nesta investigacao: moveTable (lib/api.ts)
-- fazia UPDATE direto em orders.table_id -- a migration 022 revogou todo
-- INSERT/UPDATE/DELETE anonimo em orders sem criar RPC substituta pra mover
-- pedidos entre mesas. Mover mesa esta quebrado silenciosamente desde
-- 2026-07-07 (RLS bloqueia o update, sem erro visivel).
create or replace function public.move_table_secure(p_source_table_id uuid, p_target_table_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_target_status text;
  v_source record;
  v_new_pin text;
begin
  select status into v_target_status from tables where id = p_target_table_id;
  if v_target_status is null then
    return jsonb_build_object('success', false, 'message', 'Mesa de destino não encontrada.');
  end if;
  if v_target_status != 'available' then
    return jsonb_build_object('success', false, 'message', 'Mesa de destino não está disponível.');
  end if;

  select * into v_source from tables where id = p_source_table_id;
  if v_source is null then
    return jsonb_build_object('success', false, 'message', 'Mesa de origem não encontrada.');
  end if;

  update orders set table_id = p_target_table_id
  where table_id = p_source_table_id and status not in ('delivered', 'canceled');

  update tables set
    status = v_source.status,
    current_host_name = v_source.current_host_name,
    waiter_requested = v_source.waiter_requested,
    guest_count = v_source.guest_count
  where id = p_target_table_id;

  v_new_pin := lpad(floor(random() * 9000 + 1000)::text, 4, '0');
  update tables set
    status = 'available', current_host_name = null, waiter_requested = false, guest_count = 0, pin = v_new_pin
  where id = p_source_table_id;

  update table_sessions set table_id = p_target_table_id
  where table_id = p_source_table_id and closed_at is null;

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.move_table_secure(uuid, uuid) to anon, authenticated;

create or replace function public.finalize_table_secure(p_table_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_new_pin text;
begin
  v_new_pin := lpad(floor(random() * 9000 + 1000)::text, 4, '0');

  update tables set
    status = 'available', current_host_name = null, pin = v_new_pin,
    waiter_requested = false, service_fee_removed = false
  where id = p_table_id;

  update table_sessions set closed_at = now()
  where table_id = p_table_id and closed_at is null;

  return v_new_pin;
end;
$$;
grant execute on function public.finalize_table_secure(uuid) to anon, authenticated;

-- Cobre os 3 pontos que hoje inserem/deletam tables direto: createStore
-- (0 -> N mesas), duplicateStore (clona a contagem da loja original) e
-- updateStore (ajusta N pra mais ou pra menos). Sempre calcula a diferenca
-- entre a contagem atual e a contagem alvo.
create or replace function public.sync_store_tables_secure(p_store_id uuid, p_target_count int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_current_count int;
  v_max_number int;
begin
  select count(*), coalesce(max(number), 0) into v_current_count, v_max_number
  from tables where store_id = p_store_id;

  if p_target_count > v_current_count then
    insert into tables (store_id, number, pin, status)
    select p_store_id, v_max_number + gs, lpad(floor(random() * 9000 + 1000)::text, 4, '0'), 'available'
    from generate_series(1, p_target_count - v_current_count) as gs;
  elsif p_target_count < v_current_count then
    delete from tables where id in (
      select id from tables where store_id = p_store_id order by number desc limit (v_current_count - p_target_count)
    );
  end if;
end;
$$;
grant execute on function public.sync_store_tables_secure(uuid, int) to anon, authenticated;
