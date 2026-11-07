-- Teste da 194 (grupo apagado no Estoque). Roda dentro de BEGIN ... ROLLBACK; nada fica no banco.
insert into stores (id, name, slug, stock_mode) values ('00000000-0000-0000-0000-00000000a194', 'TESTE 194', 'teste-194', 'proprio');
insert into store_ntb_estoque_secrets (store_id, ntb_estoque_url, ntb_estoque_api_key, ativo) values ('00000000-0000-0000-0000-00000000a194', 'https://x', 'k194', true);
do $$
declare s uuid := '00000000-0000-0000-0000-00000000a194'; g1 uuid; g2 uuid; c1 uuid; c2 uuid; c3 uuid; r jsonb; n int;
begin
  insert into category_groups (store_id, name, estoque_grupo_id) values (s, 'Bebidas', 1001) returning id into g1;
  insert into category_groups (store_id, name, estoque_grupo_id) values (s, 'Vazio', 1002) returning id into g2;
  insert into categories (store_id, name, group_id, estoque_grupo_id) values (s, 'Sucos', g1, 2001) returning id into c1;
  insert into categories (store_id, name, group_id, estoque_grupo_id) values (s, 'Sem produto', g1, 2002) returning id into c2;
  insert into categories (store_id, name, group_id) values (s, 'Do Vendas', g1) returning id into c3;
  insert into products (store_id, category_id, name, price, available) values (s, c1, 'Suco de Uva', 9, true);
  delete from sync_estoque_outbox where store_id = s;

  r := desligar_grupos_estoque(s, array[2001, 2002, 1002, 1001, 9999]::bigint[]);
  assert (r ->> 'apagados')::int = 2 and (r ->> 'desligados')::int = 2, 'contagem: ' || r::text;
  assert exists (select 1 from categories where id = c1 and estoque_grupo_id is null), 'categoria com produto fica, sem ligação';
  assert (select category_id from products where store_id = s) = c1, 'produto continua na categoria';
  assert not exists (select 1 from categories where id = c2), 'categoria vazia apagada';
  assert not exists (select 1 from category_groups where id = g2), 'grupo de categorias vazio apagado';
  assert exists (select 1 from category_groups where id = g1 and estoque_grupo_id is null), 'grupo com categorias fica, sem ligação';
  assert exists (select 1 from categories where id = c3), 'categoria do próprio Vendas intacta';
  select count(*) into n from sync_estoque_outbox where store_id = s;
  assert n = 0, 'sem eco para o Estoque: ' || n;
  -- de novo = nada (idempotente)
  r := desligar_grupos_estoque(s, array[2001, 2002, 1002, 1001]::bigint[]);
  assert (r ->> 'apagados')::int = 0 and (r ->> 'desligados')::int = 0, 'idempotente: ' || r::text;
  raise notice '194 GRUPO APAGADO OK';
end $$;
