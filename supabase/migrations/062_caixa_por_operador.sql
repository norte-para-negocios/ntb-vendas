-- Caixa por operador (2026-08-28, pedido direto do dono, ao vivo, no dia
-- do teste de impressão na loja) — corrige o escopo V1 documentado na
-- própria migration 051 ("V1 não suporta múltiplos caixas simultâneos,
-- isso é P1"): hoje só existe UM turno de caixa aberto por vez, POR LOJA,
-- independente de QUEM abriu. Na prática: se o Operador A abre o caixa, o
-- Operador B não consegue abrir o dele — teria que usar o turno do A pra
-- finalizar pagamento, quebrando a responsabilização individual que o
-- dono quer (cada login bate ponto, vende, e fecha o PRÓPRIO caixa pra
-- prestação de contas depois, com conferência de dinheiro/histórico só
-- daquele operador). Mesmo padrão já usado em `operator_checkins`
-- (migration 056, `operator_checkins_one_open_per_user`) — replicado
-- aqui pra `cash_shifts`.
--
-- Escopo desta migration: só o "um turno por operador" em si (banco +
-- RPCs). Ponto (`operator_checkins`) continua width propósito
-- independente de caixa (não é a mesma coisa — alguém pode bater ponto
-- sem nunca abrir caixa, ex. garçom). "Histórico por operador" na tela de
-- vendas (`operatorBreakdown`, StoreModule.tsx) já existe e não muda —
-- continua agrupando por `payment_details.operador_nome`, já correto pra
-- múltiplos turnos concorrentes sem nenhuma mudança.

drop index if exists cash_shifts_one_open_per_store;
create unique index cash_shifts_one_open_per_operator on cash_shifts (store_id, operator_user_id) where status = 'open';
-- Nota sobre a conta universal (operator_user_id null, migration 052):
-- índice único do Postgres NÃO trata múltiplos NULL como duplicata (é o
-- comportamento padrão de UNIQUE/NULL em qualquer banco SQL) — então a
-- conta universal pode abrir mais de um turno "sem operador" concorrente
-- sem ser barrada. Aceitável: universal é uma conta de equipe
-- compartilhada, não uma identidade individual de operador — o problema
-- que esta migration resolve é especificamente entre operadores REAIS
-- (cada `store_users.id` distinto), que é o caso que o dono pediu.

-- open_cash_shift_secure: mesma assinatura de sempre (052), só troca a
-- checagem de unicidade de "existe ALGUM turno aberto nesta loja" pra
-- "existe um turno aberto nesta loja PRA ESTE OPERADOR" — `is not
-- distinct from` trata null corretamente (null = null deveria "bater" pra
-- fins desta checagem, ao contrário do `=` padrão de SQL). Mensagem de
-- erro ajustada pra refletir que é sobre O SEU turno, não "um turno
-- qualquer da loja".
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
declare
  v_id uuid;
begin
  if exists (
    select 1 from cash_shifts
    where store_id = p_store_id and status = 'open'
      and operator_user_id is not distinct from p_operator_user_id
  ) then
    return jsonb_build_object('success', false, 'message', 'Você já tem um turno de caixa aberto.');
  end if;

  insert into cash_shifts (store_id, operator_user_id, opening_float, notes)
  values (p_store_id, p_operator_user_id, p_opening_float, p_notes)
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('success', false, 'message', 'Você já tem um turno de caixa aberto.');
when foreign_key_violation then
  return jsonb_build_object('success', false, 'message', 'Não foi possível identificar o operador para abrir o turno.');
end;
$$;
grant execute on function public.open_cash_shift_secure(uuid, uuid, numeric, text) to anon, authenticated;

-- fetch_open_cash_shift_secure: ganha p_operator_user_id (obrigatório,
-- não default — todo call site do client já sabe quem é o operador
-- logado nesse momento, ver lib/api.ts/StoreModule.tsx). Muda de "existe
-- no máximo 1 por loja" pra "existe no máximo 1 por (loja, operador)" —
-- `limit 1`/`order by opened_at desc` como cinto de segurança (nunca
-- deveria haver mais de 1 pelo índice único acima, mas não custa nada
-- pra uma query de leitura). Assinatura muda de (uuid) pra (uuid, uuid)
-- — DROP explícito primeiro (mesmo motivo já documentado na migration
-- 052 pro open_cash_shift_secure: CREATE OR REPLACE com lista de
-- parâmetros diferente cria overload novo, não substitui).
drop function if exists public.fetch_open_cash_shift_secure(uuid);
create function public.fetch_open_cash_shift_secure(p_store_id uuid, p_operator_user_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(s) from (
    select * from cash_shifts
    where store_id = p_store_id and status = 'open'
      and operator_user_id is not distinct from p_operator_user_id
    order by opened_at desc
    limit 1
  ) s;
$$;
grant execute on function public.fetch_open_cash_shift_secure(uuid, uuid) to anon, authenticated;

-- fetch_open_cash_shifts_secure (NOVA, plural): lista TODOS os turnos
-- abertos de uma loja agora, com o nome do operador — pro dashboard
-- (StoreDashboardView, "Turno de caixa") e qualquer outra tela de visão
-- gerencial que precise saber "quantos caixas estão abertos agora e por
-- quem", já que isso deixou de ser sempre 0 ou 1. `fetch_open_cash_shift_secure`
-- (singular) continua existindo pra quem só quer "o MEU turno".
create function public.fetch_open_cash_shifts_secure(p_store_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(s) order by s.opened_at asc), '[]'::jsonb)
  from (
    select cs.*, su.name as operator_name
    from cash_shifts cs
    left join store_users su on su.id = cs.operator_user_id
    where cs.store_id = p_store_id and cs.status = 'open'
  ) s;
$$;
grant execute on function public.fetch_open_cash_shifts_secure(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
