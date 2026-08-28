-- Bug real achado em QA ao vivo (2026-08-27): a checagem de "mesa ocupada"
-- adicionada em updateStore (lib/api.ts, item A.2 do catálogo da reunião)
-- usava `supabase.from('tables').select(..., {count:'exact', head:true})`
-- direto com a chave anônima -- mas `tables` não tem NENHUMA policy de
-- SELECT pro anon desde a migration 031 (select_tables_none, using(false)).
-- O select sempre voltava vazio (sem erro visível), `activeCount` sempre
-- undefined/0, e a troca pra "Apenas Balcão" nunca era bloqueada mesmo com
-- mesa ocupada -- confirmado ao vivo: mesa marcada 'occupied' não impediu
-- o salvar. Corrigido com a mesma RPC security definer já usada em todo o
-- resto do acesso a `tables` (ver migration 030).
create or replace function public.count_active_tables_secure(p_store_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from tables
  where store_id = p_store_id and status in ('occupied', 'waiting_bill');
$$;
grant execute on function public.count_active_tables_secure(uuid) to anon, authenticated;
