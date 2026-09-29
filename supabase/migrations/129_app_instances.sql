-- Versão do app que cada computador/aparelho da loja está rodando (2026-09-29): o Sertão passou
-- horas com o Caixa numa versão antiga sem ninguém enxergar isso. O app desktop informa no
-- mesmo heartbeat do motor de impressão. Mesma postura de print_agent_status (dado não sensível,
-- gravado direto pelo app com a chave anon).
create table if not exists app_instances (
  store_id uuid not null references stores(id) on delete cascade,
  machine text not null,
  platform text not null default 'windows',
  app_version text not null,
  last_seen_at timestamptz not null default now(),
  primary key (store_id, machine)
);
alter table app_instances enable row level security;
drop policy if exists app_instances_anon_all on app_instances;
create policy app_instances_anon_all on app_instances for all to anon, authenticated using (true) with check (true);
notify pgrst, 'reload schema';
