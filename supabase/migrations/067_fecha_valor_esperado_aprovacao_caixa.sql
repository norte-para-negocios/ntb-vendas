-- Achado ao vivo (2026-08-30, implementador da Task 1 do plano de varredura
-- de design/UX): close_cash_shift_secure (migration 063) já calculava
-- v_expected/v_difference antes de decidir se a diferença estoura a
-- tolerância, mas o branch requires_approval nunca devolvia esses valores
-- pro client -- o modal de aprovação de supervisor mostrava "R$ 0,00" em
-- vez da diferença real, obrigando o supervisor a aprovar sem saber o
-- tamanho real do problema. Não é falha de segurança (a trava em si
-- funcionava certo, e o valor gravado no fechamento final sempre esteve
-- correto) -- é um bug de exibição que enfraquecia o propósito de ter um
-- humano checando antes de aprovar. CREATE OR REPLACE (assinatura
-- idêntica à 063, sem DROP necessário).

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
      return jsonb_build_object(
        'success', false,
        'requires_approval', true,
        'message', 'Diferença acima do limite — precisa de aprovação de um supervisor.',
        'expected_cash', v_expected,
        'closing_counted_cash', p_closing_counted_cash,
        'difference', v_difference
      );
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
