-- Achado ao vivo (2026-08-28, dono testando na loja): pedir pra digitar o
-- nome exato da impressora USB instalada no Windows/Mac é burocracia
-- desnecessária e sujeita a erro de digitação -- o computador já sabe
-- quais impressoras estão instaladas nele. O agente local (print-agent/)
-- passa a detectar sozinho e gravar aqui; a aba Impressão lê daqui pra
-- mostrar como lista de seleção em vez de campo de texto livre.

create table if not exists discovered_printers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  updated_at timestamptz not null default now(),
  unique (store_id, name)
);
create index if not exists idx_discovered_printers_store on discovered_printers(store_id);

alter table discovered_printers enable row level security;
create policy "allow_all_anon" on discovered_printers for all to anon, authenticated using (true) with check (true);
