-- Correção de 2 Criticals achados na revisão final da branch "Frente de
-- Caixa" (ver .superpowers/sdd/2026-08-23-frente-de-caixa/final-review.md).
-- Os dois nasceram do encaixe entre tasks diferentes, invisível numa
-- revisão task-por-task.

-- ─── Critical #1 — dinheiro de mesa contado em dobro no fechamento ─────────
-- `close_table_orders_secure` (migration 021) grava o MESMO
-- `payment_details` (mesmo total, methods, cash_shift_id) em TODAS as
-- linhas de `orders` ainda abertas de uma mesa. `_cash_shift_expected_cash`
-- e `fetch_cash_shift_summary_secure` somavam por LINHA de `orders` — uma
-- mesa com 2 rodadas de pedido (2 linhas) contava o mesmo pagamento 2x.
-- Pedido de balcão não tem esse problema (sem table_id, sempre 1 pedido =
-- 1 pagamento).
--
-- Correção: deduplicar o "evento de pagamento" antes de somar — agrupar
-- por (coalesce(table_id, id), payment_details) via `distinct on`, de
-- forma que múltiplas linhas de orders da MESMA mesa com o MESMO objeto
-- payment_details contem uma vez só. Pedido de balcão (table_id null) usa
-- o próprio id como chave de dedup, então sempre conta 1:1 como antes.
create or replace function public._cash_shift_expected_cash(p_shift_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select
    coalesce((select opening_float from cash_shifts where id = p_shift_id), 0)
    + coalesce((
      select sum((m->>'amount')::numeric)
      from (
        select distinct on (coalesce(o.table_id::text, o.id::text), o.payment_details)
          o.payment_details
        from orders o
        where o.store_id = (select store_id from cash_shifts where id = p_shift_id)
          and o.payment_details->>'cash_shift_id' = p_shift_id::text
      ) dedup, jsonb_array_elements(dedup.payment_details->'methods') m
      where m->>'method' = 'CASH'
    ), 0)
    - coalesce((select sum(amount) from cash_movements where shift_id = p_shift_id and type = 'sangria'), 0)
    + coalesce((select sum(amount) from cash_movements where shift_id = p_shift_id and type = 'suprimento'), 0);
$$;

create or replace function public.fetch_cash_shift_summary_secure(p_shift_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift cash_shifts%rowtype;
  v_totals_by_method jsonb;
  v_sangria numeric;
  v_suprimento numeric;
  v_expected numeric;
begin
  select * into v_shift from cash_shifts where id = p_shift_id;
  if not found then
    return null;
  end if;

  -- Mesmo dedup do helper acima: uma linha por evento de pagamento
  -- (mesa=1x por fechamento, independente de quantos pedidos ela tinha
  -- abertos; balcão continua 1:1) antes de explodir os methods.
  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into v_totals_by_method
  from (
    select m->>'method' as method, sum((m->>'amount')::numeric) as total
    from (
      select distinct on (coalesce(o.table_id::text, o.id::text), o.payment_details)
        o.payment_details
      from orders o
      where o.store_id = v_shift.store_id
        and o.payment_details->>'cash_shift_id' = p_shift_id::text
    ) dedup, jsonb_array_elements(dedup.payment_details->'methods') m
    group by m->>'method'
  ) t;

  select coalesce(sum(amount), 0) into v_sangria from cash_movements where shift_id = p_shift_id and type = 'sangria';
  select coalesce(sum(amount), 0) into v_suprimento from cash_movements where shift_id = p_shift_id and type = 'suprimento';
  v_expected := public._cash_shift_expected_cash(p_shift_id);

  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'totals_by_method', v_totals_by_method,
    'total_sangria', v_sangria,
    'total_suprimento', v_suprimento,
    'expected_cash', v_expected,
    'closing_counted_cash', v_shift.closing_counted_cash,
    'difference', case when v_shift.status = 'closed' then v_shift.closing_counted_cash - v_expected else null end
  );
end;
$$;

-- ─── Critical #2 — conta universal não consegue abrir turno ────────────────
-- `cash_shifts.operator_user_id` era `not null references store_users(id)`.
-- A conta universal (`universal_users`, login único da equipe Norte) tem um
-- id de uma tabela diferente — a FK estourava com 23503 cru sempre que ela
-- tentava abrir turno. No Sertão (só 2 store_users, cashier+waiter, nenhum
-- owner) a conta universal é o ÚNICO acesso da equipe Norte à loja: sem
-- correção, beco sem saída real (não teórico) sempre que o caixa cadastrado
-- não estiver disponível.
--
-- Correção escolhida (a mais simples, recomendada pela revisão): tornar a
-- coluna nullable e trocar a FK por ON DELETE SET NULL (deixa de barrar
-- null, e um store_user apagado no futuro não quebra o turno histórico).
-- O client (StoreModule.tsx) passa null quando role === 'universal' e
-- registra a identificação legível do operador em `notes` (coluna já
-- existente, sem uso até agora).
alter table cash_shifts alter column operator_user_id drop not null;
alter table cash_shifts drop constraint cash_shifts_operator_user_id_fkey;
alter table cash_shifts add constraint cash_shifts_operator_user_id_fkey
  foreign key (operator_user_id) references store_users(id) on delete set null;

-- open_cash_shift_secure: aceita operator_user_id null (já é o caso comum
-- agora) e, no mesmo espírito do handler de unique_violation já existente,
-- captura foreign_key_violation (não deveria mais ocorrer pra este fluxo
-- específico já que a coluna aceita null, mas cobre qualquer outro motivo
-- de violação de FK sem deixar a exceção crua do Postgres subir pro
-- toast do operador) e devolve mensagem legível.
--
-- p_notes é parâmetro novo — CREATE OR REPLACE com um parâmetro extra no
-- fim (mesmo com DEFAULT) não substitui a function original, cria um
-- OVERLOAD novo (a assinatura de 3 argumentos continua existindo e
-- respondendo via PostgREST). Confirmado ao aplicar em produção. Por isso
-- o DROP explícito abaixo antes do CREATE — mesmo cuidado já documentado
-- no pedido desta correção ("se mudar a lista de parâmetros, use DROP
-- FUNCTION IF EXISTS primeiro").
drop function if exists public.open_cash_shift_secure(uuid, uuid, numeric);
create or replace function public.open_cash_shift_secure(
  p_store_id uuid,
  p_operator_user_id uuid,
  p_opening_float numeric,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- p_notes adicionado no fim, com default, pra não precisar de DROP FUNCTION
-- (mesmo padrão documentado no AGENTS.md pra evoluir assinatura de RPC sem
-- perder objetos dependentes). Usado pelo client pra guardar a
-- identificação legível do operador universal (ex. nome/email) quando
-- p_operator_user_id é null — a coluna `notes` já existia, sem uso até
-- agora.
declare
  v_id uuid;
begin
  if exists (select 1 from cash_shifts where store_id = p_store_id and status = 'open') then
    return jsonb_build_object('success', false, 'message', 'Já existe um turno aberto para esta loja.');
  end if;

  insert into cash_shifts (store_id, operator_user_id, opening_float, notes)
  values (p_store_id, p_operator_user_id, p_opening_float, p_notes)
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('success', false, 'message', 'Já existe um turno aberto para esta loja.');
when foreign_key_violation then
  return jsonb_build_object('success', false, 'message', 'Não foi possível identificar o operador para abrir o turno.');
end;
$$;
grant execute on function public.open_cash_shift_secure(uuid, uuid, numeric, text) to anon, authenticated;

notify pgrst, 'reload schema';
