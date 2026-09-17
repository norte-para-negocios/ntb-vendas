-- RPC dedicada pra vincular/desvincular um produto a um omie_codigo já
-- existente, sem passar por update_product_secure (que não tem esse
-- parâmetro) e sem criar nada novo no Omie/ntb-estoque (diferente do fluxo
-- "Criar no NTB Estoque também", que gera um SKU novo via API).
create or replace function set_product_omie_codigo_secure(
  p_product_id uuid,
  p_store_id uuid,
  p_omie_codigo text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update products
  set omie_codigo = nullif(trim(p_omie_codigo), '')
  where id = p_product_id
    and store_id = p_store_id;
end;
$$;

grant execute on function set_product_omie_codigo_secure(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
