-- Corrige o upload do certificado digital fiscal, que nunca funcionou de
-- verdade desde a 006_fiscal_certificado.sql: `storage.buckets` tem RLS
-- ligado mas sem NENHUMA policy, então o papel `anon` (usado pelo app
-- inteiro, sem Supabase Auth) não consegue nem ler os metadados do bucket
-- durante o upload, e a Storage API rejeita a escrita com
-- "new row violates row-level security policy".
--
-- Isso nunca deu problema nos outros dois buckets (store-logos,
-- product-images) porque os dois são públicos; store-certificates é o
-- único privado do projeto, e é justamente o caminho de bucket privado que
-- precisa consultar essa tabela. Confirmado testando de verdade: upload
-- real na loja Bistrô Demo falhava com 403 antes desta migration.
--
-- Ler metadados do bucket (id, nome, se é público) não expõe nenhum dado
-- sigiloso, o segredo continua sendo só o conteúdo dos arquivos em
-- storage.objects, que não tem policy de select nenhuma.

drop policy if exists "buckets_select_anon" on storage.buckets;
create policy "buckets_select_anon" on storage.buckets
  for select to anon, authenticated
  using (id = 'store-certificates');
