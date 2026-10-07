-- Roda DENTRO de BEGIN ... ROLLBACK, depois da 171. Loja de teste temporária.
do $$
declare v_store uuid := gen_random_uuid(); v_cat uuid; r jsonb; a boolean; b boolean; c boolean;
begin
  insert into stores (id, name, slug, contract_type, is_active, stock_mode) values (v_store, 'ZZ T171', 'zz-t171-' || substr(v_store::text,1,8), 'balcao', true, 'proprio');
  insert into category_groups (id, store_id, name, "order", estoque_grupo_id) values (gen_random_uuid(), v_store, 'Bebidas', 0, 9171001);
  r := aplicar_catalogo_estoque(v_store, jsonb_build_object(
    'grupos', jsonb_build_array(jsonb_build_object('estoque_id', 9171001, 'nome', 'Bebidas', 'pai_id', null, 'ordem', 0)),
    'produtos', jsonb_build_array(
      jsonb_build_object('codigo', '90171', 'nome', 'Suco T171', 'preco', 9, 'ativo', true, 'grupo_estoque_id', 9171001, 'updated_at', now()),
      jsonb_build_object('codigo', '90172', 'nome', 'Sem preco T171', 'preco', 0, 'ativo', true, 'grupo_estoque_id', 9171001, 'updated_at', now()),
      jsonb_build_object('codigo', '90173', 'nome', 'Sem grupo T171', 'preco', 7, 'ativo', true, 'updated_at', now()))));
  select available into a from products where store_id = v_store and omie_codigo = '90171';
  select available into b from products where store_id = v_store and omie_codigo = '90172';
  select available into c from products where store_id = v_store and omie_codigo = '90173';
  assert a is true, 'com categoria e preço deve entrar disponível';
  assert b is false, 'sem preço fica indisponível';
  assert c is false, 'sem categoria fica indisponível';
  -- lojista desativa; reenvio do Estoque ativo não reativa
  update products set available = false where store_id = v_store and omie_codigo = '90171';
  perform aplicar_catalogo_estoque(v_store, jsonb_build_object('produtos', jsonb_build_array(
    jsonb_build_object('codigo', '90171', 'nome', 'Suco T171', 'preco', 9, 'ativo', true, 'grupo_estoque_id', 9171001, 'updated_at', now() + interval '1 minute'))));
  select available into a from products where store_id = v_store and omie_codigo = '90171';
  assert a is false, 'nunca reativa o que o lojista desativou';
  raise notice 'CATALOGO 171 OK';
end $$;
