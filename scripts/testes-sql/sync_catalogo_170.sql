-- Teste da sincronização de catálogo (170). Roda dentro de BEGIN ... ROLLBACK; nada fica no banco.
insert into stores (id, name, slug, stock_mode) values ('00000000-0000-0000-0000-00000000a170', 'TESTE SYNC', 'teste-sync-170', 'proprio');
insert into store_ntb_estoque_secrets (store_id, ntb_estoque_url, ntb_estoque_api_key, ativo) values ('00000000-0000-0000-0000-00000000a170', 'https://x', 'k', true);

do $$
declare
  s uuid := '00000000-0000-0000-0000-00000000a170'; r jsonb; n int; v_cat uuid; v_pm uuid; v_ps uuid; v_grp uuid; v_o1 uuid; v_o2 uuid; v_cg uuid;
  cm text := 'M90010'; pay jsonb; e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid();
begin
  -- 1) cadastro normal entra no outbox (uma linha pendente por entidade)
  insert into category_groups (store_id, name) values (s, 'Bebidas') returning id into v_cg;
  insert into categories (store_id, name, group_id) values (s, 'Sucos', v_cg) returning id into v_cat;
  insert into products (store_id, category_id, name, price, available) values (s, v_cat, 'Suco de Uva', 9, true) returning id into v_ps;
  update products set price = 10 where id = v_ps;
  select count(*) into n from sync_estoque_outbox where store_id = s and entidade = 'produto' and ref = v_ps::text and status = 'pending';
  assert n = 1, 'outbox colapsa: ' || n;
  select count(*) into n from sync_estoque_outbox where store_id = s and entidade = 'categoria' and status = 'pending';
  assert n = 1, 'categoria no outbox';
  -- loja sem integração ativa não gera outbox
  insert into stores (id, name, slug) values ('00000000-0000-0000-0000-00000000b170', 'SEM SYNC', 'sem-sync-170');
  insert into products (store_id, name, price) values ('00000000-0000-0000-0000-00000000b170', 'X', 1);
  select count(*) into n from sync_estoque_outbox where store_id = '00000000-0000-0000-0000-00000000b170';
  assert n = 0, 'loja omie sem outbox';

  -- 2) catálogo para o Estoque: produto simples sem código sai com codigo null; mãe e variações
  insert into products (store_id, category_id, name, price, available) values (s, v_cat, 'Moqueca', 80, true) returning id into v_pm;
  insert into product_option_groups (product_id, name, type, required) values (v_pm, 'Tamanho', 'single', true) returning id into v_grp;
  insert into product_options (group_id, name, price_delta, omie_codigo) values (v_grp, 'Individual', 0, null), (v_grp, 'Família', 70, null);
  r := catalogo_para_estoque(s, array[v_ps, v_pm], null, null);
  assert jsonb_array_length(r -> 'produtos') = 2, 'sem código nas opções = produto simples (' || jsonb_array_length(r -> 'produtos') || ')';
  update product_options set omie_codigo = '90011' where group_id = v_grp and name = 'Individual';
  update product_options set omie_codigo = '90012' where group_id = v_grp and name = 'Família';
  r := catalogo_para_estoque(s, array[v_pm], null, null);
  assert jsonb_array_length(r -> 'produtos') = 3, 'mãe + 2 variações';
  assert (r -> 'produtos' -> 0 ->> 'mae')::boolean, 'primeiro é a mãe';
  assert (r -> 'produtos' -> 2 ->> 'preco')::numeric = 150, 'preço da variação = base + acréscimo';
  assert exists (select 1 from jsonb_array_elements(r -> 'grupos') x where x ->> 'nome' = 'Bebidas'), 'grupo raiz incluído';

  -- 3) mapa de volta: mãe ganha estoque_pai_codigo (omie_codigo continua nulo), simples ganha omie_codigo
  perform aplicar_mapa_estoque(s, jsonb_build_object('produtos', jsonb_build_array(
     jsonb_build_object('vendas_ref', v_pm, 'codigo', cm), jsonb_build_object('vendas_ref', v_ps, 'codigo', '90001'))));
  assert (select estoque_pai_codigo from products where id = v_pm) = cm and (select omie_codigo from products where id = v_pm) is null, 'mãe sem omie_codigo';
  assert (select omie_codigo from products where id = v_ps) = '90001', 'simples ganha código';
  select count(*) into n from sync_estoque_outbox where store_id = s and status = 'pending' and updated_at > now() - interval '1 second' and false;

  -- 4) aplicar catálogo do Estoque: grupo raiz, subgrupo, 3º nível (não materializa), produto novo indisponível, variação, preço do Vendas vence
  delete from sync_estoque_outbox where store_id = s;
  r := aplicar_catalogo_estoque(s, jsonb_build_object(
    'grupos', jsonb_build_array(
      jsonb_build_object('estoque_id', 11, 'nome', 'Cozinha', 'ordem', 1, 'updated_at', '2999-01-01T00:00:00Z'),
      jsonb_build_object('estoque_id', 12, 'nome', 'Petiscos', 'pai_estoque_id', 11, 'ordem', 1, 'updated_at', '2999-01-01T00:00:00Z'),
      jsonb_build_object('estoque_id', 13, 'nome', 'Fritas', 'pai_estoque_id', 12, 'ordem', 1, 'updated_at', '2999-01-01T00:00:00Z')),
    'produtos', jsonb_build_array(
      jsonb_build_object('codigo', '90020', 'vendas_ref', null, 'nome', 'Batata Frita', 'preco', 28, 'ativo', true, 'grupo_estoque_id', 13, 'ncm', '20041000'),
      jsonb_build_object('codigo', '90001', 'nome', 'Suco de Uva Novo', 'preco', 99, 'ativo', true, 'updated_at', '2000-01-01T00:00:00Z'),
      jsonb_build_object('codigo', '90030', 'nome', 'Pizza', 'preco', 40, 'mae', true, 'grupo_estoque_id', 12),
      jsonb_build_object('codigo', '90031', 'nome', 'Pizza - G', 'preco', 60, 'pai_codigo', '90030', 'atributos', jsonb_build_object('Tamanho', 'G')),
      jsonb_build_object('codigo', '90032', 'nome', 'Pizza - P', 'preco', 40, 'pai_codigo', '90030', 'atributos', jsonb_build_object('Tamanho', 'P')))));
  assert exists (select 1 from category_groups where store_id = s and estoque_grupo_id = 11), 'grupo raiz criado';
  assert exists (select 1 from categories where store_id = s and estoque_grupo_id = 12 and name = 'Petiscos'), 'subgrupo vira categoria';
  assert not exists (select 1 from categories where store_id = s and estoque_grupo_id = 13), '3º nível não vira categoria';
  select category_id into v_cat from products where store_id = s and omie_codigo = '90020';
  assert (select name from categories where id = v_cat) = 'Petiscos', 'produto do 3º nível cai na categoria do ancestral';
  assert not (select available from products where store_id = s and omie_codigo = '90020'), 'produto novo nasce indisponível';
  assert (select price from products where id = v_ps) = 10, 'preço do Vendas vence (não virou 99)';
  assert (select name from products where id = v_ps) = 'Suco de Uva', 'nome mais antigo não vence';
  select id into v_pm from products where store_id = s and estoque_pai_codigo = '90030';
  assert v_pm is not null and (select omie_codigo from products where id = v_pm) is null, 'mãe nova sem omie_codigo';
  assert (select price from products where id = v_pm) = 40, 'preço da mãe = menor variação';
  select count(*) into n from product_options o join product_option_groups g on g.id = o.group_id where g.product_id = v_pm;
  assert n = 2, 'duas variações';
  assert (select price_delta from product_options where omie_codigo = '90031') = 20 and (select price_delta from product_options where omie_codigo = '90032') = 0, 'acréscimos sobre o menor preço';
  select count(*) into n from sync_estoque_outbox where store_id = s;
  assert n = 0, 'sem eco no outbox (' || n || ')';

  -- 5) idempotência
  r := aplicar_catalogo_estoque(s, jsonb_build_object('produtos', jsonb_build_array(
      jsonb_build_object('codigo', '90031', 'nome', 'Pizza - G', 'preco', 60, 'pai_codigo', '90030', 'atributos', jsonb_build_object('Tamanho', 'G')))));
  select count(*) into n from product_options where omie_codigo = '90031';
  assert n = 1, 'variação não duplica';
  r := aplicar_catalogo_estoque(s, jsonb_build_object('produtos', jsonb_build_array(jsonb_build_object('codigo', '90020', 'nome', 'Batata Frita', 'preco', 28))));
  select count(*) into n from products where store_id = s and omie_codigo = '90020';
  assert n = 1, 'produto não duplica';

  -- reconciliação enfileira só o que falta
  delete from sync_estoque_outbox where store_id = s;
  update products set estoque_sync_at = now() where store_id = s;
  n := enfileirar_catalogo_pendente(s);
  assert n >= 1, 'enfileira categoria/grupo sem vínculo (' || n || ')';
  assert not exists (select 1 from sync_estoque_outbox where store_id = s and entidade = 'produto'), 'produto já carimbado não reenfileira';

  -- 6) loja não-proprio recusa
  begin
    perform aplicar_catalogo_estoque('00000000-0000-0000-0000-00000000b170', '{}'::jsonb);
    assert false, 'omie recusa';
  exception when sqlstate '22023' then null; end;
  raise notice 'SYNC170 OK';
end $$;
