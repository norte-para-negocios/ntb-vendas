do $$
declare n int; m text;
begin
  select count(*) into n from stores where stock_mode <> 'omie';
  assert n = 0, 'toda loja existente deve ficar em omie';
  insert into stores (name, slug, stock_mode) values ('ZZ TESTE 168', 'zz-teste-168-rollback', 'proprio');
  select stock_mode into m from stores where slug = 'zz-teste-168-rollback';
  assert m = 'proprio', 'grava proprio';
  begin
    update stores set stock_mode = 'invalido' where slug = 'zz-teste-168-rollback';
    assert false, 'check deveria barrar';
  exception when check_violation then null; end;
  raise notice 'STOCK_MODE OK';
end $$;
do $$ declare t boolean; begin
  t := store_tem_baixas_secure((select id from stores where slug='zz-teste-168-rollback'));
  assert t = false, 'loja nova sem baixas';
  raise notice 'BAIXAS FN OK';
end $$;
do $$ declare n int; sid uuid; oid uuid; tid uuid; begin
  -- loja 'nenhum' com integração ativa e um pedido entregue antigo: NÃO aparece na varredura; a mesma loja em 'omie' aparece.
  select id into sid from stores where slug='zz-teste-168-rollback';
  insert into store_ntb_estoque_secrets (store_id, ntb_estoque_url, ntb_estoque_api_key, ativo) values (sid, 'http://x', 'k', true);
  insert into orders (store_id, order_type, status, total, updated_at, created_at, payment_details) values (sid, 'counter', 'delivered', 10, now() - interval '10 minutes', now() - interval '10 minutes', '{"total": 10}'::jsonb) returning id into oid;
  update stores set stock_mode = 'nenhum' where id = sid;
  select count(*) into n from listar_pedidos_sem_baixa_secure(50, sid);
  assert n = 0, 'nenhum não entra na varredura ' || n;
  update stores set stock_mode = 'omie' where id = sid;
  select count(*) into n from listar_pedidos_sem_baixa_secure(50, sid);
  assert n = 1, 'omie entra na varredura ' || n;
  update stores set stock_mode = 'proprio' where id = sid;
  select count(*) into n from listar_pedidos_sem_baixa_secure(50, sid);
  assert n = 1, 'proprio entra na varredura ' || n;
  raise notice 'VARREDURA OK';
end $$;
