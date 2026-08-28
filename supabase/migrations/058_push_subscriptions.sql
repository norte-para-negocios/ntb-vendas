-- Push notification real (Fase 5, Task 19, plano "Fora do Cardápio",
-- 2026-08-27) — primeira infraestrutura de push de verdade do projeto.
-- Antes disso, "notificação" no cardápio do cliente só funcionava com a
-- aba aberta (Web Audio API + toast, ver lib/audioAlert.ts) — não cobria
-- app fechado/tela bloqueada, que é exatamente o caso mais comum (cliente
-- fecha o navegador esperando o prato ficar pronto).
--
-- Assinatura é por ORDER, não por sessão de mesa/cliente: o
-- OrderTracker (ClientModule.tsx) já rastreia um `orderId` específico
-- (pedido de balcão OU sessão de mesa em andamento) — é o mesmo escopo
-- que já faz sentido pra notificação ("seu pedido X ficou pronto"), sem
-- precisar inventar um conceito de sessão novo. Um pedido pode ter mais
-- de uma assinatura (cliente abriu em dois aparelhos, ou trocou de
-- aparelho no meio) — todas recebem o push.
--
-- Dado não sensível (endpoint/chaves de push são específicos do
-- navegador do cliente, sem valor fora desse contexto) — mesmo nível de
-- order_ratings/operator_checkins, RLS allow_all_anon direto, sem RPC
-- dedicada.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_order_id_idx on push_subscriptions (order_id);

alter table push_subscriptions enable row level security;
drop policy if exists "allow_all_anon" on push_subscriptions;
create policy "allow_all_anon" on push_subscriptions
  for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
