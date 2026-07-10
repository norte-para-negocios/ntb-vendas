-- Fecha o achado critico de seguranca (2026-07-09): allow_all_anon de
-- 001_schema_inicial.sql/004_table_sessions.sql permitia SELECT/UPDATE/
-- INSERT/DELETE sem filtro em tables/table_sessions pra qualquer um com a
-- anon key publica (pin de qualquer mesa de qualquer loja legivel em texto
-- puro). Mesmo padrao de 022_revoga_anon_orders_products.sql: todo acesso
-- real ja migrou pras RPCs security definer da migration 030 -- este e' so
-- o corte do caminho antigo.

drop policy if exists allow_all_anon on tables;
drop policy if exists allow_all_anon on table_sessions;

create policy select_tables_none on tables for select using (false);
create policy select_table_sessions_none on table_sessions for select using (false);
