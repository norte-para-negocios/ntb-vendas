-- 155: destino (Cozinha/Bar) de uma categoria inteira de uma vez (04/10/2026, Administração > Locais de preparo).
-- Cozinha e Bar são products.destination por PRODUTO; products não aceita UPDATE direto do app (RLS fechada).
-- Função NOVA e aditiva: não altera nenhuma função existente. Devolve quantos produtos mudaram de destino.
create or replace function public.set_category_destination_secure(p_store_id uuid, p_category_id uuid, p_destination text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_n integer;
begin
  if p_destination is null or p_destination not in ('kitchen', 'bar') then
    raise exception 'Destino inválido: use kitchen ou bar.';
  end if;
  if not exists (select 1 from categories where id = p_category_id and store_id = p_store_id) then
    raise exception 'Categoria não encontrada nesta loja.';
  end if;
  update products set destination = p_destination
   where category_id = p_category_id and store_id = p_store_id
     and destination is distinct from p_destination;
  get diagnostics v_n = row_count;
  update categories set sector_id = null where id = p_category_id and store_id = p_store_id;
  return v_n;
end;
$$;
grant execute on function public.set_category_destination_secure(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
