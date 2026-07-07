-- Configuracao do emissor fiscal por loja (2026-07-07) — so' os campos,
-- sem logica de emissao real ainda (ver AGENTS.md, secao dedicada, e
-- docs/plans/2026-07-07-config-emissor-fiscal-plan.md pro contexto
-- completo). Dois padroes ja estabelecidos: campos nao-sigilosos publicos
-- (mesmo nivel de store_fiscal_certificates) e CSC/CSCID write-only (mesma
-- sensibilidade da senha do certificado).

create table if not exists store_fiscal_config (
  store_id uuid primary key references stores(id) on delete cascade,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  nfe_serie int,
  nfce_serie int,
  cte_serie int,
  mdfe_serie int,
  nfe_ultimo_numero int not null default 0,
  nfce_ultimo_numero int not null default 0,
  cte_ultimo_numero int not null default 0,
  mdfe_ultimo_numero int not null default 0,
  inscricao_municipal text,
  casas_decimais int not null default 2,
  cnpj_autorizado text,
  observacao_nfe text,
  observacao_pedido text,
  updated_at timestamptz not null default now()
);

alter table store_fiscal_config enable row level security;
drop policy if exists "allow_all_anon" on store_fiscal_config;
create policy "allow_all_anon" on store_fiscal_config
  for all to anon, authenticated using (true) with check (true);

-- CSC/CSCID separados por ambiente (a mesma loja precisa ter os dois pares
-- prontos, pra poder alternar homologacao<->producao sem reconfigurar).
-- Write-only de verdade, mesmo principio da senha do certificado
-- (006_fiscal_certificado.sql): sem NENHUMA policy de SELECT pra anon.
create table if not exists store_fiscal_config_secrets (
  store_id uuid primary key references stores(id) on delete cascade,
  csc_homologacao text,
  cscid_homologacao text,
  csc_producao text,
  cscid_producao text,
  updated_at timestamptz not null default now()
);

alter table store_fiscal_config_secrets enable row level security;

drop policy if exists "fiscal_secrets_insert_anon" on store_fiscal_config_secrets;
create policy "fiscal_secrets_insert_anon" on store_fiscal_config_secrets
  for insert to anon, authenticated with check (true);

drop policy if exists "fiscal_secrets_update_anon" on store_fiscal_config_secrets;
create policy "fiscal_secrets_update_anon" on store_fiscal_config_secrets
  for update to anon, authenticated using (true) with check (true);

-- Sem policy de select/delete — mesmo padrao de store_fiscal_certificate_secrets.

