-- Aba "Impressão" pedida pelo dono (2026-08-27, teste na loja no dia
-- seguinte): hoje a impressão automática (CaixaPrintStation.tsx) só sabe
-- imprimir na impressora PADRÃO DO SISTEMA OPERACIONAL do aparelho do
-- caixa, via window.print() -- não existe conceito de "escolher qual
-- impressora" nem de mandar direto pra uma impressora de REDE (IP) sem
-- depender daquele navegador/aba específica ficar aberto. Estas duas
-- tabelas cobrem isso:
--
-- printer_configs: cadastro de impressora por loja. connection_type=
-- 'browser_default' é só metadado (não muda nada tecnicamente -- continua
-- sendo o window.print() de sempre); 'network' (IP+porta, ESC/POS puro,
-- praticamente universal em impressora térmica) e 'usb' (nome do
-- dispositivo/impressora já instalado no Windows/Linux do aparelho) são
-- consumidos por um agente local novo (print-agent/, fora do Next.js --
-- roda no PC da loja) que manda o ticket direto, sem passar pelo
-- diálogo de impressão do navegador.
--
-- print_jobs: fila de verdade, persistida no servidor (ao contrário do
-- dedupe em localStorage do CaixaPrintStation, que só existe na memória
-- de UM navegador) -- histórico visível na aba nova, e o que o agente
-- local consome pra imprimir nas impressoras 'network'/'usb'.
--
-- Sensibilidade: nome/IP de impressora e texto de ticket (que já é
-- semi-público -- mesmo conteúdo que aparece na tela da cozinha) não tem
-- o mesmo risco de PIN/senha/preço que já motivou RPC security definer
-- em outras tabelas (orders/tables/products) -- allow_all_anon aqui é
-- decisão consciente de ir rápido, mesmo padrão de categories/products.

create table if not exists printer_configs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  connection_type text not null check (connection_type in ('browser_default', 'network', 'usb')),
  ip_address text,
  port int not null default 9100,
  usb_system_name text,
  destination text not null default 'all' check (destination in ('kitchen', 'bar', 'all')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_printer_configs_store on printer_configs(store_id);

alter table printer_configs enable row level security;
create policy "allow_all_anon" on printer_configs for all to anon, authenticated using (true) with check (true);

create table if not exists print_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  printer_config_id uuid references printer_configs(id) on delete set null,
  destination text not null check (destination in ('kitchen', 'bar', 'all')),
  title text not null,
  content text not null,
  status text not null default 'pending' check (status in ('pending', 'printing', 'done', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  printed_at timestamptz
);
create index if not exists idx_print_jobs_store_status on print_jobs(store_id, status, created_at);
create index if not exists idx_print_jobs_printer_pending on print_jobs(printer_config_id, status) where status = 'pending';

alter table print_jobs enable row level security;
create policy "allow_all_anon" on print_jobs for all to anon, authenticated using (true) with check (true);

alter publication supabase_realtime add table print_jobs;
