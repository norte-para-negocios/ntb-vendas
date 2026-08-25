-- Subprojeto 2 do plano "aprimorar caixa sem acompanhamento" (2026-08-25):
-- histórico de turnos passados, consultável a qualquer momento (não só
-- durante o fechamento). `fetch_cash_shift_summary_secure` (migration 052)
-- já devolve `closing_counted_cash`/`difference` persistidos pra turno
-- fechado — só faltava uma function pra LISTAR os turnos em si, pra dar o
-- id de cada um pra chamar a summary de novo depois.
create function public.fetch_cash_shifts_history_secure(p_store_id uuid, p_limit int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  from (
    select
      cs.id,
      cs.opened_at,
      cs.closed_at,
      cs.opening_float,
      cs.closing_counted_cash,
      cs.status,
      cs.notes,
      su.name as operator_name,
      -- Diferença só faz sentido pra turno já fechado; turno aberto (no
      -- máximo 1 por loja, migration 051) nunca aparece aqui com diferença
      -- calculada — evita rodar _cash_shift_expected_cash à toa pra ele.
      case when cs.status = 'closed'
        then cs.closing_counted_cash - public._cash_shift_expected_cash(cs.id)
        else null
      end as difference
    from cash_shifts cs
    left join store_users su on su.id = cs.operator_user_id
    where cs.store_id = p_store_id
    order by cs.opened_at desc
    limit least(coalesce(p_limit, 30), 100)
  ) t;
$$;
grant execute on function public.fetch_cash_shifts_history_secure(uuid, int) to anon, authenticated;
