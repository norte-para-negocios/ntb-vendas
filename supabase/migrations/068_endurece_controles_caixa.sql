-- Endurece os controles de caixa das Tasks 1/2 (achados da revisão final de
-- branch do plano de varredura 2026-08-30, feita num modelo mais capaz
-- depois das 10 tasks já revisadas individualmente):
--
-- 1. close_cash_shift_secure (063, reescrita em 067) confiava em
--    p_max_tolerance vindo do CLIENT — qualquer um com a chave anônima
--    pública podia chamar a RPC direto com p_max_tolerance: null e fechar
--    qualquer diferença sem aprovação nem rastro. Corrigido: o valor real
--    agora é sempre lido de stores.config no servidor, via o store_id do
--    próprio turno — o parâmetro continua existindo na assinatura (evita
--    quebrar lib/api.ts) mas é ignorado.
-- 2. Mesmo problema em register_cash_movement_secure com p_alert_threshold
--    (dava pra suprimir o evento de auditoria de sangria grande mandando um
--    threshold artificialmente alto, ou null).
-- 3. close_cash_shift_secure nunca checava se o supervisor aprovador
--    (p_approved_by_user_id) pertence à MESMA loja do turno — um
--    owner/supervisor de QUALQUER outra loja da plataforma podia aprovar o
--    fechamento de uma loja que não é a dele (verify_cash_supervisor_secure,
--    usado pelo caminho normal da UI, já filtrava por store_id
--    corretamente; o problema era só a RPC de fechamento em si, que é o
--    limite de confiança real).
-- 4. Novo event_type ('tolerancia_excedida') pro achado #5 abaixo — precisa
--    entrar no CHECK antes de qualquer function que insira esse valor.
alter table cash_shift_audit_events drop constraint if exists cash_shift_audit_events_event_type_check;
alter table cash_shift_audit_events add constraint cash_shift_audit_events_event_type_check
  check (event_type in ('item_cancelado', 'sangria_grande', 'tolerancia_excedida'));

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

  -- Achado #3 (revisão final): p_max_tolerance nunca é confiável vindo do
  -- client — sempre lido aqui, da própria loja do turno.
  select (config->>'cash_shift_max_tolerance')::numeric into v_max_tolerance
  from stores where id = v_shift.store_id;

  v_expected := public._cash_shift_expected_cash(p_shift_id);
  v_difference := p_closing_counted_cash - v_expected;

  if v_max_tolerance is not null and abs(v_difference) > v_max_tolerance then
    select coalesce(name, 'Conta universal') into v_operator_name
    from store_users where id = v_shift.operator_user_id;

    -- Achado #5 (revisão final): antes, uma diferença que estourava a
    -- tolerância só virava rastro se de fato fosse aprovada — cancelar e
    -- ajustar a contagem pra caber na tolerância não deixava vestígio
    -- nenhum. Agora toda tentativa (aprovada ou não) grava evento.
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
    -- Achado #4 (revisão final): faltava `store_id = v_shift.store_id` —
    -- sem isso, um approved_by_user_id de QUALQUER loja da plataforma que
    -- por coincidência fosse owner/supervisor lá aprovava fechamento aqui.
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
-- CREATE OR REPLACE com assinatura idêntica — grant persiste, mas reafirmado
-- por clareza/segurança (mesmo padrão já usado na migration 067).
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

  -- Achado #3 (revisão final): mesmo problema de close_cash_shift_secure —
  -- p_alert_threshold vindo do client dava pra suprimir o evento de sangria
  -- grande mandando null ou um valor artificialmente alto. Lido aqui, da
  -- própria loja do turno, ignorando o parâmetro.
  select (config->>'cash_shift_sangria_alert_threshold')::numeric into v_alert_threshold
  from stores where id = v_shift.store_id;

  if p_type = 'sangria' and p_operator_name is not null and v_alert_threshold is not null and p_amount >= v_alert_threshold then
    insert into cash_shift_audit_events (store_id, shift_id, operator_user_id, operator_name, event_type, details)
    values (v_shift.store_id, p_shift_id, v_shift.operator_user_id, p_operator_name, 'sangria_grande', jsonb_build_object('valor', p_amount, 'motivo', p_reason));
  end if;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;
grant execute on function public.register_cash_movement_secure(uuid, text, numeric, text, text, numeric) to anon, authenticated;

notify pgrst, 'reload schema';
