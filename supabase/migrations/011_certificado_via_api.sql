-- Move o upload/remoção do certificado digital fiscal pra rodar via
-- app/api/certificado (service role key, bypassa RLS) em vez do client
-- direto com a chave anônima.
--
-- Motivo: testando de verdade (upload real na loja Bistrô Demo), a
-- 006_fiscal_certificado.sql nunca funcionou. A API de Storage do Supabase
-- precisa LER a linha de volta depois de gravar (tipo um
-- INSERT ... RETURNING) pra montar a resposta, e o `.list()` usado na
-- limpeza de certificado órfão (deleteStore) também exige leitura. Ambos
-- exigem policy de SELECT em storage.objects — e essa é exatamente a
-- policy que dar pra `anon` deixaria o .pfx baixável por qualquer um com a
-- chave pública (SELECT no Storage do Supabase controla tanto listar
-- quanto baixar o arquivo). A 010_fix_storage_buckets_rls.sql tentou uma
-- correção mais simples (só a leitura de storage.buckets), mas não foi
-- suficiente — o buraco real está em storage.objects.
--
-- A partir de agora ninguém com a chave anônima grava, lê nem apaga nada
-- neste bucket: só a rota de servidor, com a service role key.

drop policy if exists "cert_upload_anon" on storage.objects;
drop policy if exists "cert_update_anon" on storage.objects;
drop policy if exists "cert_delete_anon" on storage.objects;

-- A policy de leitura de storage.buckets da 010 também deixa de ser
-- necessária: a service role ignora RLS por completo.
drop policy if exists "buckets_select_anon" on storage.buckets;
