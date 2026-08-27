-- "Bater ponto" por operador (2026-08-27, pedido real do usuário na
-- sessão de continuação da reunião com o Ramon): o garçom clica um botão
-- pra marcar início/fim do próprio turno de trabalho — não tem nada a
-- ver com cash_shifts (migration 051), que é o turno do CAIXA físico da
-- loja (um só aberto por vez, fundo de troco, sangria/suprimento). Aqui
-- é ponto pessoal: vários operadores podem estar "batidos" ao mesmo
-- tempo na mesma loja, sem relação com quem abriu o caixa. Dado não
-- sensível (só nome+horário) — mesmo nível de order_ratings (013), RLS
-- allow_all_anon direto, sem RPC dedicada.
create table operator_checkins (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  -- Sem FK: pode ser store_users.id OU universal_users.id (mesma
  -- ambiguidade já aceita em orders.payment_details.operador_id, que
  -- também não tem FK por esse motivo).
  user_id uuid not null,
  user_name text not null,
  checkin_at timestamptz not null default now(),
  checkout_at timestamptz
);

-- No máximo 1 turno aberto por operador por vez — evita bater ponto de
-- novo sem encerrar o anterior (F5/troca de aba não deveria abrir dois).
create unique index operator_checkins_one_open_per_user on operator_checkins (store_id, user_id) where checkout_at is null;
create index operator_checkins_store_id_idx on operator_checkins (store_id, checkin_at desc);

alter table operator_checkins enable row level security;
drop policy if exists "allow_all_anon" on operator_checkins;
create policy "allow_all_anon" on operator_checkins
  for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
