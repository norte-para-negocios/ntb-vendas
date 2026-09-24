-- products não tem update direto pra anon (usa RPC): setor do produto por RPC.
create or replace function public.set_product_sector_secure(p_product_id uuid, p_store_id uuid, p_sector_id uuid)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $$
  update products set sector_id = p_sector_id where id = p_product_id and store_id = p_store_id;
$$;
grant execute on function public.set_product_sector_secure(uuid, uuid, uuid) to anon, authenticated;
notify pgrst, 'reload schema';
