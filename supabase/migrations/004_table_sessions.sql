-- Histórico de abertura/fechamento de mesa, para calcular tempo médio de
-- ocupação de verdade. A tabela `tables` reaproveita a mesma linha a cada
-- ciclo (abre -> fecha -> abre de novo), então não dá pra saber quanto
-- tempo uma ocupação específica durou sem um histórico separado.

create table if not exists table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references tables(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  host_name text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists idx_table_sessions_store_id on table_sessions(store_id);
create index if not exists idx_table_sessions_table_id on table_sessions(table_id);
create index if not exists idx_table_sessions_open on table_sessions(table_id) where closed_at is null;

alter table table_sessions enable row level security;
drop policy if exists "allow_all_anon" on table_sessions;
create policy "allow_all_anon" on table_sessions for all to anon, authenticated using (true) with check (true);

-- open_table_session (migration 003) passa a gravar a sessão quando uma mesa
-- LIVRE é aberta por um novo host (não quando um convidado só entra numa mesa
-- já ocupada, e não é acionada por abertura manual do lojista, que tem seu
-- próprio helper openTableManually em lib/api.ts).
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

  select * into v_store from stores where id = v_table.store_id;

  v_pin_required := (v_table.status <> 'available')
                     or coalesce((v_store.config->>'require_pin_for_open')::boolean, false);

  if v_pin_required and (p_pin is null or p_pin <> v_table.pin) then
    return jsonb_build_object(
      'success', false,
      'message', case when v_table.status <> 'available'
                      then 'Mesa já ocupada! Peça o PIN ao anfitrião.'
                      else 'PIN incorreto.' end
    );
  end if;

  if v_table.status = 'available' then
    update tables set status = 'occupied', current_host_name = p_host_name where id = p_table_id;
    insert into table_sessions (table_id, store_id, host_name) values (p_table_id, v_table.store_id, p_host_name);
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
