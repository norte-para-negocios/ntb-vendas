-- Espaço pra loja cadastrar o certificado digital fiscal (fase de
-- armazenamento apenas — emissão de NFC-e/SEFAZ é trabalho futuro
-- separado, ver "Backlog / Próximos passos" em AGENTS.md).
--
-- Sem Supabase Auth neste projeto (ver 001_schema_inicial.sql), então
-- "privado" aqui significa: sem NENHUMA policy de SELECT pra anon — dá
-- pra escrever mas não pra ler de volta usando a chave anônima. Mesmo
-- princípio do PIN de mesa em 003_secure_table_pin.sql, generalizado
-- pra um segredo de verdade (senha do certificado + o próprio .pfx).

-- ─── Bucket privado do certificado ────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('store-certificates', 'store-certificates', false)
on conflict (id) do nothing;

drop policy if exists "cert_upload_anon" on storage.objects;
create policy "cert_upload_anon" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'store-certificates');

drop policy if exists "cert_update_anon" on storage.objects;
create policy "cert_update_anon" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'store-certificates')
  with check (bucket_id = 'store-certificates');

-- Sem policy de select/delete pra este bucket: upload feito às cegas,
-- ninguém baixa o .pfx de volta usando a anon key.

-- ─── Metadados legíveis (não é sigiloso, a UI do admin precisa listar) ────────
create table if not exists store_fiscal_certificates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references stores(id) on delete cascade,
  file_path text not null,
  original_filename text not null,
  uploaded_at timestamptz not null default now(),
  expires_at date,
  created_at timestamptz not null default now()
);

alter table store_fiscal_certificates enable row level security;
drop policy if exists "allow_all_anon" on store_fiscal_certificates;
create policy "allow_all_anon" on store_fiscal_certificates
  for all to anon, authenticated using (true) with check (true);

-- ─── Senha do certificado — write-only de verdade ─────────────────────────────
create table if not exists store_fiscal_certificate_secrets (
  store_id uuid primary key references stores(id) on delete cascade,
  password text not null,
  updated_at timestamptz not null default now()
);

alter table store_fiscal_certificate_secrets enable row level security;

drop policy if exists "cert_secret_insert_anon" on store_fiscal_certificate_secrets;
create policy "cert_secret_insert_anon" on store_fiscal_certificate_secrets
  for insert to anon, authenticated with check (true);

drop policy if exists "cert_secret_update_anon" on store_fiscal_certificate_secrets;
create policy "cert_secret_update_anon" on store_fiscal_certificate_secrets
  for update to anon, authenticated using (true) with check (true);

-- Sem policy de select: RLS nega por padrão pra quem só tem a anon key.
-- Só um processo futuro com service role (quando a emissão de NFC-e for
-- implementada) vai conseguir ler essa senha de volta.
