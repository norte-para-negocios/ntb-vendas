-- Achado real (auditoria "o que falta", 2026-08-27 — catálogo item B11 da
-- reunião com o Ramon, 2026-08-25): "relatório de fechamento de caixa
-- detalhado por bandeira" — hoje fetch_cash_shift_summary_secure (051) só
-- agrupa por MÉTODO (crédito/débito/pix/dinheiro), nunca por bandeira
-- (Mastercard, Alelo etc.), que é o que o operador confere contra a
-- maquineta física no fechamento. Aditivo: recria a function só pra
-- acrescentar `totals_by_brand` na mesma resposta, sem mudar nada do que
-- já funciona.
create or replace function public.fetch_cash_shift_summary_secure(p_shift_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift cash_shifts%rowtype;
  v_totals_by_method jsonb;
  v_totals_by_brand jsonb;
  v_sangria numeric;
  v_suprimento numeric;
  v_expected numeric;
begin
  select * into v_shift from cash_shifts where id = p_shift_id;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into v_totals_by_method
  from (
    select m->>'method' as method, sum((m->>'amount')::numeric) as total
    from orders o, jsonb_array_elements(o.payment_details->'methods') m
    where o.store_id = v_shift.store_id
      and o.payment_details->>'cash_shift_id' = p_shift_id::text
    group by m->>'method'
  ) t;

  -- Só crédito/débito têm bandeira de verdade (PIX/dinheiro não têm esse
  -- conceito); o campo é opcional na tela de pagamento, então pagamento
  -- sem bandeira escolhida simplesmente não entra aqui (nunca vira "Sem
  -- bandeira" fantasma — evita poluir o relatório com algo que o operador
  -- não tem como conferir contra a maquineta).
  select coalesce(jsonb_object_agg(brand, total), '{}'::jsonb) into v_totals_by_brand
  from (
    select m->>'brand' as brand, sum((m->>'amount')::numeric) as total
    from orders o, jsonb_array_elements(o.payment_details->'methods') m
    where o.store_id = v_shift.store_id
      and o.payment_details->>'cash_shift_id' = p_shift_id::text
      and m->>'method' in ('CREDIT', 'DEBIT')
      and m->>'brand' is not null
    group by m->>'brand'
  ) t;

  select coalesce(sum(amount), 0) into v_sangria from cash_movements where shift_id = p_shift_id and type = 'sangria';
  select coalesce(sum(amount), 0) into v_suprimento from cash_movements where shift_id = p_shift_id and type = 'suprimento';
  v_expected := public._cash_shift_expected_cash(p_shift_id);

  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'totals_by_method', v_totals_by_method,
    'totals_by_brand', v_totals_by_brand,
    'total_sangria', v_sangria,
    'total_suprimento', v_suprimento,
    'expected_cash', v_expected,
    'closing_counted_cash', v_shift.closing_counted_cash,
    'difference', case when v_shift.status = 'closed' then v_shift.closing_counted_cash - v_expected else null end
  );
end;
$$;

notify pgrst, 'reload schema';
