-- 194: grupo apagado no Estoque (lojas stock_mode='proprio'). O Estoque manda os ids apagados em `grupos_apagados`
-- (rota /api/integracao/catalogo). Categoria/grupo de categorias VAZIO é apagado; com produto (ou, na categoria, com
-- tabela de preço) só perde a ligação com o Estoque e fica no cardápio: apagar soltaria os produtos (FK set null) e
-- eles sumiriam do cardápio. Sem eco: ntb.sync_skip=1 (o gatilho do outbox não manda o delete de volta).
create or replace function public.desligar_grupos_estoque(p_store uuid, p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; v_id bigint; c record; v_apagados int := 0; v_desligados int := 0;
begin
  select stock_mode into v_modo from stores where id = p_store;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_store using errcode = '22023'; end if;
  perform set_config('ntb.sync_skip', '1', true);
  foreach v_id in array coalesce(p_ids, '{}'::bigint[]) loop
    -- categoria (2º nível no Estoque)
    for c in select id from categories where store_id = p_store and estoque_grupo_id = v_id loop
      if exists (select 1 from products where category_id = c.id) or exists (select 1 from price_schedules where category_id = c.id) then
        update categories set estoque_grupo_id = null where id = c.id; v_desligados := v_desligados + 1;
      else
        delete from categories where id = c.id; v_apagados := v_apagados + 1;
      end if;
    end loop;
    -- grupo de categorias (raiz no Estoque)
    for c in select id from category_groups where store_id = p_store and estoque_grupo_id = v_id loop
      if exists (select 1 from categories where group_id = c.id) then
        update category_groups set estoque_grupo_id = null where id = c.id; v_desligados := v_desligados + 1;
      else
        delete from category_groups where id = c.id; v_apagados := v_apagados + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('apagados', v_apagados, 'desligados', v_desligados);
end $$;
revoke all on function public.desligar_grupos_estoque(uuid, bigint[]) from public, anon, authenticated;
grant execute on function public.desligar_grupos_estoque(uuid, bigint[]) to service_role;
