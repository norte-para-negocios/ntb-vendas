-- Heartbeat do agente local de impressão (print-agent/agent.js).
--
-- Achado ao vivo (2026-08-28/29): não havia nenhum jeito de saber, pela
-- tela do painel, se o agente estava realmente rodando no computador da
-- loja -- só dava pra adivinhar olhando se a fila de impressão andava.
-- O agente já atualiza a lista de impressoras instaladas a cada 30s
-- (discovered_printers, migration 065); esta tabela reaproveita esse
-- mesmo ciclo pra gravar "estou vivo, agora são X horas, Y impressoras
-- carregadas" -- o painel decide "conectado"/"offline" comparando
-- last_seen_at contra o relógio do próprio navegador (nunca contra o
-- relógio do agente, que pode estar errado).
create table if not exists print_agent_status (
  store_id uuid primary key references stores(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  printers_loaded int not null default 0,
  updated_at timestamptz not null default now()
);

alter table print_agent_status enable row level security;

-- Mesmo nível de sensibilidade de printer_configs/print_jobs (migration
-- 061): nem nome de impressora nem conteúdo de ticket, só "vivo desde
-- quando" -- não há dado sensível pra restringir aqui.
create policy "allow_all_anon" on print_agent_status
  for all to anon, authenticated using (true) with check (true);
