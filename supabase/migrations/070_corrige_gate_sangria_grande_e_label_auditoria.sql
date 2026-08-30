-- Dois achados da re-review do lote de correções da revisão final de
-- branch (2026-08-30, ainda no mesmo dia):
--
-- 1. register_cash_movement_secure (068/069) já parou de confiar em
--    p_alert_threshold vindo do client, mas o INSERT do evento
--    'sangria_grande' continuava condicionado a `p_operator_name is not
--    null` — o mesmo parâmetro vindo do client. Chamar a RPC direto com a
--    chave anônima e `p_operator_name: null` suprimia o evento de
--    auditoria (o movimento em si continuava sendo gravado normalmente,
--    só o rastro de "sangria grande" sumia) — mesma classe de furo do
--    achado #3 original, só que por outro parâmetro. Corrigido resolvendo
--    o nome do operador no servidor (mesmo padrão já usado em
--    close_cash_shift_secure via v_shift.operator_user_id), e tirando
--    p_operator_name da decisão de gravar ou não o evento.
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
  v_operator_name text;
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

  -- p_operator_name não decide mais SE o evento é gravado — só o
  -- tipo/valor/tolerância, todos resolvidos/lidos no servidor.
  if p_type = 'sangria' and v_alert_threshold is not null and v_alert_threshold > 0 and p_amount >= v_alert_threshold then
    select coalesce(name, 'Conta universal') into v_operator_name
    from store_users where id = v_shift.operator_user_id;

    insert into cash_shift_audit_events (store_id, shift_id, operator_user_id, operator_name, event_type, details)
    values (v_shift.store_id, p_shift_id, v_shift.operator_user_id, coalesce(v_operator_name, p_operator_name, 'Operador'), 'sangria_grande', jsonb_build_object('valor', p_amount, 'motivo', p_reason));
  end if;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;
grant execute on function public.register_cash_movement_secure(uuid, text, numeric, text, text, numeric) to anon, authenticated;

notify pgrst, 'reload schema';
