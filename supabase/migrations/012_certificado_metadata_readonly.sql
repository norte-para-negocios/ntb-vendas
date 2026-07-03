-- store_fiscal_certificates tinha policy "allow_all_anon" (ALL) porque,
-- até agora, o client gravava direto nela via upsert. A partir da
-- 011_certificado_via_api.sql/rota /api/certificado, toda escrita passou
-- pro servidor (service role, ignora RLS). O client só precisa continuar
-- lendo essa tabela pra mostrar o badge de status do certificado
-- (fetchStoreCertificateStatus) — não precisa mais escrever nela.

drop policy if exists "allow_all_anon" on store_fiscal_certificates;

drop policy if exists "cert_metadata_select_anon" on store_fiscal_certificates;
create policy "cert_metadata_select_anon" on store_fiscal_certificates
  for select to anon, authenticated
  using (true);
