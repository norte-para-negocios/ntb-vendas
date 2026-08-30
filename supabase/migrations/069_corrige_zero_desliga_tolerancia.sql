-- Corrige um bug real introduzido pela própria migration 068 (achado
-- testando ao vivo, no mesmo dia): o client sempre tratou
-- `cash_shift_max_tolerance`/`cash_shift_sangria_alert_threshold` iguais a
-- 0 como "desligado" (`lib/api.ts`/handlers em StoreModule.tsx usam
-- `store.config?.cash_shift_max_tolerance || undefined` — `0 || undefined`
-- vira `undefined`, documentado em AGENTS.md como "0/undefined = off").
-- A 068 passou a ler o valor direto de stores.config no servidor (pra
-- parar de confiar no parâmetro vindo do client — ver 068), mas comparou
-- só contra `is not null`, não contra o mesmo "0 também é off" que o
-- client sempre respeitou. Resultado: uma loja com o campo salvo como "0"
-- (em vez de nunca ter sido tocado, que fica null/ausente) passava a
-- exigir aprovação de supervisor pra QUALQUER diferença de caixa, por
-- menor que fosse — reproduzido ao vivo na ZZ Laboratorio ao reverter a
-- tolerância de teste de volta pra "0" pela própria tela de Configurações.
create or replace function public.close_cash_shift_secure(
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
  v_max_tolerance numeric;
  v_operator_name text;
begin
  select * into v_shift from cash_shifts where id = p_shift_id;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Turno não encontrado.');
  end if;
  if v_shift.status = 'closed' then
    return jsonb_build_object('success', false, 'message', 'Este turno já está fechado.');
  end if;

  select (config->>'cash_shift_max_tolerance')::numeric into v_max_tolerance
  from stores where id = v_shift.store_id;

  v_expected := public._cash_shift_expected_cash(p_shift_id);
  v_difference := p_closing_counted_cash - v_expected;

  -- `v_max_tolerance > 0` (não só `is not null`) — 0 é "desligado", mesma
  -- convenção já usada em todo o resto do sistema pra este campo.
  if v_max_tolerance is not null and v_max_tolerance > 0 and abs(v_difference) > v_max_tolerance then
    select coalesce(name, 'Conta universal') into v_operator_name
    from store_users where id = v_shift.operator_user_id;

    insert into cash_shift_audit_events (store_id, shift_id, operator_user_id, operator_name, event_type, details)
    values (
      v_shift.store_id, p_shift_id, v_shift.operator_user_id, coalesce(v_operator_name, 'Operador'),
      'tolerancia_excedida',
      jsonb_build_object('esperado', v_expected, 'contado', p_closing_counted_cash, 'diferenca', v_difference, 'tolerancia', v_max_tolerance)
    );

    if p_approved_by_user_id is null then
      return jsonb_build_object(
        'success', false,
        'requires_approval', true,
        'message', 'Diferença acima do limite — precisa de aprovação de um supervisor.',
        'expected_cash', v_expected,
        'closing_counted_cash', p_closing_counted_cash,
        'difference', v_difference
      );
    end if;
    select * into v_approver from store_users
      where id = p_approved_by_user_id and store_id = v_shift.store_id;
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

create or replace function public.register_cash_movement_secure(
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
  v_alert_threshold numeric;
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

  select (config->>'cash_shift_sangria_alert_threshold')::numeric into v_alert_threshold
  from stores where id = v_shift.store_id;

  -- Mesma correção: `v_alert_threshold > 0`, 0 é "desligado".
  if p_type = 'sangria' and p_operator_name is not null and v_alert_threshold is not null and v_alert_threshold > 0 and p_amount >= v_alert_threshold then
    insert into cash_shift_audit_events (store_id, shift_id, operator_user_id, operator_name, event_type, details)
    values (v_shift.store_id, p_shift_id, v_shift.operator_user_id, p_operator_name, 'sangria_grande', jsonb_build_object('valor', p_amount, 'motivo', p_reason));
  end if;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;
grant execute on function public.register_cash_movement_secure(uuid, text, numeric, text, text, numeric) to anon, authenticated;

notify pgrst, 'reload schema';
