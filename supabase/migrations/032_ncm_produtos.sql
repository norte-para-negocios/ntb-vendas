-- NCM (Nomenclatura Comum do Mercosul) por produto — obrigatório em qualquer
-- item de NFC-e/NF-e. Antes só existia um esboço de "padrões de imposto" por
-- LOJA (migration 025), sem classificação por produto — decisão explícita do
-- usuário em 2026-08-05: NCM correto por produto, não um padrão genérico pra
-- tudo (ver docs/superpowers/specs/2026-08-05-emissao-fiscal-automatica-design.md).

alter table products add column if not exists ncm text;
