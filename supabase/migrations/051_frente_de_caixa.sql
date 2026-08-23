-- Task 1 (2026-08-23, plano "frente-de-caixa"): schema de turno de caixa
-- (cash_shifts) e movimentacoes de sangria/suprimento (cash_movements).
-- Fundacao pra Fase 1 (P0) do documento "Frente de Caixa" — papel de
-- operador ja existe (store_users com role='cashier', ver AGENTS.md "Conta
-- universal"/"014_fecha_vazamento_senhas"), o que falta e' o conceito de
-- turno em si: um turno aberto por loja, com fundo de troco, sangria/
-- suprimento, e cada pagamento rastreavel a um turno (o vinculo em si —
-- orders.payment_details.cash_shift_id — e' Task 2, nao esta migration).
--
-- E' PLATAFORMA, nao Sertao-especifico: qualquer loja com modules.caixa
-- ligado passa a ter isso. Esta migration sozinha nao muda nenhum
-- comportamento de app — nenhuma UI ainda chama estas RPCs (Tasks 2-4).
--
-- Mesmo padrao de seguranca ja estabelecido no projeto (ver AGENTS.md
-- "Decisoes de arquitetura" e migration 021): sem Supabase Auth, RLS fecha
-- tudo (`select using (false)`, sem policy de insert/update pra anon), toda
-- escrita/leitura real passa por function `security definer`, que valida
-- por argumento (nao existe sessao de servidor pra checar contra).

create table cash_shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id),
  operator_user_id uuid not null references store_users(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_float numeric not null check (opening_float >= 0),
  closing_counted_cash numeric,
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text
);

-- Regra "um turno aberto por vez, por loja" — decisao explicita do plano
-- (V1 nao suporta multiplos caixas simultaneos, isso e' P1). Enforced no
-- banco via indice parcial unico, nao logica de aplicacao: e' o jeito mais
-- barato de ser concorrency-safe (duas chamadas simultaneas de
-- open_cash_shift_secure pra mesma loja nunca conseguem as duas inserir —
-- a segunda sempre bate no unique_violation, tratado abaixo).
create unique index cash_shifts_one_open_per_store on cash_shifts (store_id) where status = 'open';

create index cash_shifts_store_id_idx on cash_shifts (store_id);

alter table cash_shifts enable row level security;
-- Sem policy de select/insert/update pra anon (mesmo posture de
-- orders/tables desde 021/022) — toda leitura/escrita real via as 5 RPCs
-- abaixo, que sao security definer e ignoram RLS internamente.
create policy cash_shifts_deny_all on cash_shifts for select using (false);

create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references cash_shifts(id),
  type text not null check (type in ('sangria', 'suprimento')),
  amount numeric not null check (amount > 0),
  reason text not null,
  created_at timestamptz not null default now()
);

create index cash_movements_shift_id_idx on cash_movements (shift_id);

alter table cash_movements enable row level security;
create policy cash_movements_deny_all on cash_movements for select using (false);

-- ─── open_cash_shift_secure ────────────────────────────────────────────────
-- Abre um turno novo pra uma loja. Recusa com jsonb {success:false} (nao
-- exception generica) se ja existe turno aberto pra essa loja — tanto no
-- caminho feliz (checagem previa) quanto sob concorrencia real (a corrida
-- entre duas chamadas simultaneas cai no unique_violation do indice
-- parcial acima, capturado aqui, mesmo padrao ja usado em
-- create_store_team_member_secure/update_store_user_secure, migration 014).
create function public.open_cash_shift_secure(
  p_store_id uuid,
  p_operator_user_id uuid,
  p_opening_float numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if exists (select 1 from cash_shifts where store_id = p_store_id and status = 'open') then
    return jsonb_build_object('success', false, 'message', 'Já existe um turno aberto para esta loja.');
  end if;

  insert into cash_shifts (store_id, operator_user_id, opening_float)
  values (p_store_id, p_operator_user_id, p_opening_float)
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('success', false, 'message', 'Já existe um turno aberto para esta loja.');
end;
$$;
grant execute on function public.open_cash_shift_secure(uuid, uuid, numeric) to anon, authenticated;

-- ─── helper interno: dinheiro esperado de um turno ─────────────────────────
-- Reutilizado por close_cash_shift_secure e fetch_cash_shift_summary_secure
-- (mesma query exata nos dois, vale factorar). Formula: soma de
-- orders.payment_details.methods onde method='CASH' e cash_shift_id bate
-- (payment_details já vinha de closeCounterOrder/closeTableSession, ver
-- lib/api.ts — {total, methods:[{method,amount,brand?}], emitir_nota?};
-- Task 2 adiciona cash_shift_id ao mesmo objeto), MENOS sangrias, MAIS
-- suprimentos registrados no turno. Não filtra por status do pedido —
-- payment_details só é gravado no fechamento (close_table_orders_secure/
-- rota de balcão), então qualquer order com esse campo preenchido já
-- representa dinheiro que realmente entrou no caixa.
create function public._cash_shift_expected_cash(p_shift_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select
    coalesce((
      select sum((m->>'amount')::numeric)
      from orders o, jsonb_array_elements(o.payment_details->'methods') m
      where (o.payment_details->>'cash_shift_id')::uuid = p_shift_id
        and m->>'method' = 'CASH'
    ), 0)
    - coalesce((select sum(amount) from cash_movements where shift_id = p_shift_id and type = 'sangria'), 0)
    + coalesce((select sum(amount) from cash_movements where shift_id = p_shift_id and type = 'suprimento'), 0);
$$;

-- ─── close_cash_shift_secure ────────────────────────────────────────────────
-- Recusa (jsonb, nao exception) se o turno ja esta fechado. Calcula o
-- esperado via o helper acima, persiste closing_counted_cash/closed_at/
-- status, e devolve a diferenca (contado - esperado) na mesma resposta —
-- caller nao precisa de round-trip extra pra saber se bateu.
create function public.close_cash_shift_secure(
  p_shift_id uuid,
  p_closing_counted_cash numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift cash_shifts%rowtype;
  v_expected numeric;
begin
  select * into v_shift from cash_shifts where id = p_shift_id;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Turno não encontrado.');
  end if;
  if v_shift.status = 'closed' then
    return jsonb_build_object('success', false, 'message', 'Este turno já está fechado.');
  end if;

  v_expected := public._cash_shift_expected_cash(p_shift_id);

  update cash_shifts set
    closing_counted_cash = p_closing_counted_cash,
    closed_at = now(),
    status = 'closed'
  where id = p_shift_id;

  return jsonb_build_object(
    'success', true,
    'expected_cash', v_expected,
    'closing_counted_cash', p_closing_counted_cash,
    'difference', p_closing_counted_cash - v_expected
  );
end;
$$;
grant execute on function public.close_cash_shift_secure(uuid, numeric) to anon, authenticated;

-- ─── register_cash_movement_secure ─────────────────────────────────────────
-- Recusa se o turno nao esta 'open' (sangria/suprimento so' fazem sentido
-- durante o turno). Revalida type/amount aqui mesmo com o CHECK da tabela
-- ja cobrindo — devolve {success:false} limpo em vez de deixar a exception
-- de constraint crua vazar pro client.
create function public.register_cash_movement_secure(
  p_shift_id uuid,
  p_type text,
  p_amount numeric,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;
grant execute on function public.register_cash_movement_secure(uuid, text, numeric, text) to anon, authenticated;

-- ─── fetch_open_cash_shift_secure ──────────────────────────────────────────
-- So' pede store_id (nao operator) — a regra e' "um turno por loja", entao
-- so' existe um pra achar. E' o que a UI usa antes de liberar qualquer
-- pagamento (Task 2) e pra decidir "mostrar tela de abrir caixa ou a fila"
-- (Task 3).
create function public.fetch_open_cash_shift_secure(p_store_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(s) from cash_shifts s where s.store_id = p_store_id and s.status = 'open';
$$;
grant execute on function public.fetch_open_cash_shift_secure(uuid) to anon, authenticated;

-- ─── fetch_cash_shift_summary_secure ───────────────────────────────────────
-- Pra um turno qualquer (aberto ou fechado): total por forma de pagamento,
-- total sangria, total suprimento, esperado (mesmo helper de
-- close_cash_shift_secure), e — so' quando o turno ja esta fechado — o
-- contado/diferenca ja persistidos. Task 4 usa isto pra renderizar a tela
-- de fechamento ao vivo enquanto o operador digita o valor contado.
create function public.fetch_cash_shift_summary_secure(p_shift_id uuid) returns jsonb
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

  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into v_totals_by_method
  from (
    select m->>'method' as method, sum((m->>'amount')::numeric) as total
    from orders o, jsonb_array_elements(o.payment_details->'methods') m
    where (o.payment_details->>'cash_shift_id')::uuid = p_shift_id
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
grant execute on function public.fetch_cash_shift_summary_secure(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
