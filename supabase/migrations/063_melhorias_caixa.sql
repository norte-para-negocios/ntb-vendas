-- Melhorias no fluxo de Caixa (2026-08-28) — ver
-- docs/superpowers/specs/2026-08-28-melhorias-fluxo-caixa-design.md pro
-- design completo. Contagem cega, breakdown por cédula/moeda, tolerância
-- em 2 níveis com aprovação de supervisor, e trilha de auditoria
-- (cancelamento de item + sangria grande) por operador.

alter table cash_shifts add column if not exists closing_cash_breakdown jsonb;
alter table cash_shifts add column if not exists approved_by_user_id uuid references store_users(id) on delete set null;

create table if not exists cash_shift_audit_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  shift_id uuid references cash_shifts(id) on delete set null,
  operator_user_id uuid references store_users(id) on delete set null,
  operator_name text not null,
  event_type text not null check (event_type in ('item_cancelado', 'sangria_grande')),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_cash_shift_audit_store on cash_shift_audit_events(store_id, created_at desc);
create index if not exists idx_cash_shift_audit_operator on cash_shift_audit_events(operator_user_id, created_at desc);
create index if not exists idx_cash_shift_audit_shift on cash_shift_audit_events(shift_id);

alter table cash_shift_audit_events enable row level security;
create policy cash_shift_audit_deny_all on cash_shift_audit_events for select using (false);

-- cancel_order_item_secure (migration 021, assinatura hoje (p_item_id uuid))
-- ganha p_operator_user_id/p_operator_name pra registrar quem cancelou.
-- DROP explícito: parâmetro novo no fim, mesmo com default, cria overload
-- em vez de substituir.
drop function if exists public.cancel_order_item_secure(uuid);
create function public.cancel_order_item_secure(
  p_item_id uuid,
  p_operator_user_id uuid default null,
  p_operator_name text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid;
  v_product_name text;
begin
  update order_items set status = 'canceled' where id = p_item_id
  returning store_id into v_store_id;

  if v_store_id is not null and p_operator_name is not null then
    select p.name into v_product_name from order_items oi
      left join products p on p.id = oi.product_id
      where oi.id = p_item_id;
    insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
    values (v_store_id, p_operator_user_id, p_operator_name, 'item_cancelado', jsonb_build_object('produto', coalesce(v_product_name, 'Produto indisponível')));
  end if;
end;
$$;
grant execute on function public.cancel_order_item_secure(uuid, uuid, text) to anon, authenticated;

-- register_cash_movement_secure (migration 051) ganha p_operator_name e
-- p_alert_threshold — mesmo cuidado de DROP FUNCTION IF EXISTS.
drop function if exists public.register_cash_movement_secure(uuid, text, numeric, text);
create function public.register_cash_movement_secure(
  p_shift_id uuid,
  p_type text,
  p_amount numeric,
  p_reason text,
  p_operator_name text default null,
  p_alert_threshold numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shift cash_shifts%rowtype;
  v_id uuid;
begin
  if p_type not in ('sangria', 'suprimento') then
    return jsonb_build_object('success', false, 'message', 'Tipo de movimentação inválido.');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'message', 'Valor deve ser maior que zero.');
  end if;

  select * into v_shift from cash_shifts where id = p_shift_id;
  if not found or v_shift.status <> 'open' then
    return jsonb_build_object('success', false, 'message', 'Turno não está aberto.');
  end if;

  insert into cash_movements (shift_id, type, amount, reason)
  values (p_shift_id, p_type, p_amount, p_reason)
  returning id into v_id;

  if p_type = 'sangria' and p_operator_name is not null and p_alert_threshold is not null and p_amount >= p_alert_threshold then
    insert into cash_shift_audit_events (store_id, shift_id, operator_user_id, operator_name, event_type, details)
    values (v_shift.store_id, p_shift_id, v_shift.operator_user_id, p_operator_name, 'sangria_grande', jsonb_build_object('valor', p_amount, 'motivo', p_reason));
  end if;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;
grant execute on function public.register_cash_movement_secure(uuid, text, numeric, text, text, numeric) to anon, authenticated;

-- close_cash_shift_secure (migration 051) ganha breakdown, tolerância
-- máxima e aprovação de supervisor. Assinatura hoje: (p_shift_id uuid,
-- p_closing_counted_cash numeric).
drop function if exists public.close_cash_shift_secure(uuid, numeric);
create function public.close_cash_shift_secure(
  p_shift_id uuid,
  p_closing_counted_cash numeric,
  p_closing_cash_breakdown jsonb default null,
  p_max_tolerance numeric default null,
  p_approved_by_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shift cash_shifts%rowtype;
  v_expected numeric;
  v_difference numeric;
  v_approver store_users%rowtype;
begin
  select * into v_shift from cash_shifts where id = p_shift_id;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Turno não encontrado.');
  end if;
  if v_shift.status = 'closed' then
    return jsonb_build_object('success', false, 'message', 'Este turno já está fechado.');
  end if;

  v_expected := public._cash_shift_expected_cash(p_shift_id);
  v_difference := p_closing_counted_cash - v_expected;

  if p_max_tolerance is not null and abs(v_difference) > p_max_tolerance then
    if p_approved_by_user_id is null then
      return jsonb_build_object('success', false, 'requires_approval', true, 'message', 'Diferença acima do limite — precisa de aprovação de um supervisor.');
    end if;
    select * into v_approver from store_users where id = p_approved_by_user_id;
    if not found or not (v_approver.role in ('owner', 'universal') or (v_approver.permissions->>'supervisiona_caixa')::boolean is true) then
      return jsonb_build_object('success', false, 'message', 'Usuário informado não tem permissão de supervisor.');
    end if;
  end if;

  update cash_shifts set
    closing_counted_cash = p_closing_counted_cash,
    closing_cash_breakdown = p_closing_cash_breakdown,
    approved_by_user_id = p_approved_by_user_id,
    closed_at = now(),
    status = 'closed'
  where id = p_shift_id;

  return jsonb_build_object(
    'success', true,
    'expected_cash', v_expected,
    'closing_counted_cash', p_closing_counted_cash,
    'difference', v_difference
  );
end;
$$;
grant execute on function public.close_cash_shift_secure(uuid, numeric, jsonb, numeric, uuid) to anon, authenticated;

-- verify_cash_supervisor_secure — mesmo padrão inline de rate-limit de
-- authenticate_store_user_secure (migration 008), mesma coluna
-- login_attempts/login_locked_until (é a mesma credencial de login).
create or replace function public.verify_cash_supervisor_secure(p_store_id uuid, p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user store_users%rowtype;
begin
  select * into v_user from store_users where store_id = p_store_id and email = p_email;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Credenciais inválidas.');
  end if;
  if v_user.login_locked_until is not null and v_user.login_locked_until > now() then
    return jsonb_build_object('success', false, 'message', 'Muitas tentativas. Aguarde alguns minutos.');
  end if;
  if v_user.password <> p_password then
    update store_users set
      login_attempts = login_attempts + 1,
      login_locked_until = case when login_attempts + 1 >= 5 then now() + interval '5 minutes' else login_locked_until end
    where id = v_user.id;
    return jsonb_build_object('success', false, 'message', 'Credenciais inválidas.');
  end if;
  if not (v_user.role in ('owner', 'universal') or (v_user.permissions->>'supervisiona_caixa')::boolean is true) then
    return jsonb_build_object('success', false, 'message', 'Este usuário não tem permissão de supervisor de caixa.');
  end if;
  update store_users set login_attempts = 0, login_locked_until = null where id = v_user.id;
  return jsonb_build_object('success', true, 'user_id', v_user.id, 'name', v_user.name);
end;
$$;
grant execute on function public.verify_cash_supervisor_secure(uuid, text, text) to anon, authenticated;

-- fetch_cash_shift_audit_secure — p_shift_id filtra "eventos deste turno",
-- p_operator_user_id (sem p_shift_id) filtra "eventos deste operador no
-- período". Os dois são independentes e opcionais.
create or replace function public.fetch_cash_shift_audit_secure(
  p_store_id uuid,
  p_shift_id uuid default null,
  p_operator_user_id uuid default null,
  p_limit int default 50
) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(e) order by e.created_at desc), '[]'::jsonb)
  from (
    select * from cash_shift_audit_events
    where store_id = p_store_id
      and (p_shift_id is null or shift_id = p_shift_id)
      and (p_operator_user_id is null or operator_user_id = p_operator_user_id)
    order by created_at desc
    limit p_limit
  ) e;
$$;
grant execute on function public.fetch_cash_shift_audit_secure(uuid, uuid, uuid, int) to anon, authenticated;

notify pgrst, 'reload schema';
