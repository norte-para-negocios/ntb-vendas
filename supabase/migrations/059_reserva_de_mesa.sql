-- Reserva de mesa direto do cardápio (Fase "Fora do Cardápio", Task 21,
-- 2026-08-27) — MVP real, não o produto completo: cliente pede a reserva
-- (nome, telefone, horário, quantas pessoas) SEM escolher mesa específica
-- (isso é decisão do lojista no dia, olhando a ocupação real). Sem
-- confirmação automática por SMS/WhatsApp e sem bloqueio automático de
-- mesa — a mesa continua sendo aberta manualmente como hoje, só com o
-- contexto de "tem gente chegando às 20h pra 4 pessoas" visível de
-- antemão.
--
-- Dado não sensível o bastante pra justificar RPC dedicada (é o mesmo
-- nível de "alguém vai aparecer no restaurante", não um dado financeiro/
-- de pedido) — mesmo padrão de order_ratings/operator_checkins, RLS
-- allow_all_anon direto: cliente cria (INSERT), lojista lê/atualiza
-- status (SELECT/UPDATE), sem exigir login pra criar.
create table table_reservations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  customer_name text not null,
  customer_phone text not null,
  party_size int not null check (party_size > 0),
  reserved_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'canceled')),
  created_at timestamptz not null default now()
);

create index table_reservations_store_id_idx on table_reservations (store_id, reserved_for);

alter table table_reservations enable row level security;
drop policy if exists "allow_all_anon" on table_reservations;
create policy "allow_all_anon" on table_reservations
  for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
