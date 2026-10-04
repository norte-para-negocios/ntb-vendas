-- 152: transferir item(ns) entre mesas (2026-10-04, plano próximas features, item 3).
-- Lançou na mesa errada: em vez de cancelar e relançar (reimprime cancelamento e comanda), move o item.
-- Mantém quem lançou, ajusta o total das duas contas e grava 'item_transferido' na auditoria. Não imprime nada
-- (o item já saiu na cozinha). Taxas (fee_type) e itens cancelados não se movem; só dono/gerente/permissão
-- 'trocas' (checado no app; o servidor confere que o operador é da loja).
create or replace function public.transfer_items_secure(
  p_store_id uuid,
  p_item_ids uuid[],
  p_target_table_id uuid,
  p_operator_user_id uuid default null,
  p_operator_name text default null,
  p_from_table_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_target tables%rowtype;
  v_item record;
  v_src_num int;
  v_total_moved numeric := 0;
  v_moved int := 0;
  v_target_order uuid;
  v_src_orders uuid[] := '{}';
begin
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    return jsonb_build_object('success', false, 'message', 'Nenhum item escolhido.');
  end if;
  select * into v_target from tables where id = p_target_table_id and store_id = p_store_id for update;
  if not found then return jsonb_build_object('success', false, 'message', 'Mesa de destino inválida.'); end if;
  if v_target.status = 'blocked' then return jsonb_build_object('success', false, 'message', 'Mesa de destino bloqueada.'); end if;
  if p_operator_user_id is not null and not exists (
       select 1 from store_users su where su.id = p_operator_user_id and su.store_id = p_store_id)
     and not exists (select 1 from universal_users u where u.id = p_operator_user_id) then
    return jsonb_build_object('success', false, 'message', 'Operador inválido.');
  end if;

  for v_item in
    select oi.id, oi.order_id, oi.quantity, oi.price_at_time, oi.status, p.name as pname, p.fee_type, o.table_id as src_table, o.status as order_status, o.customer_name
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = oi.product_id
     where oi.id = any(p_item_ids) and o.store_id = p_store_id and o.order_type = 'table'
       and o.status not in ('delivered', 'canceled')  -- conta já paga/cancelada não se mexe
     order by oi.created_at
  loop
    if v_item.status = 'canceled' or v_item.fee_type is not null or v_item.src_table = p_target_table_id then continue; end if;
    -- Desfazer: só move se o item ainda está na mesa esperada (ninguém mexeu depois).
    if p_from_table_id is not null and v_item.src_table is distinct from p_from_table_id then continue; end if;

    -- Pedido aberto da mesa de destino (que não seja só de taxa), senão cria um.
    select o.id into v_target_order from orders o
     where o.table_id = p_target_table_id and o.store_id = p_store_id and o.status not in ('delivered', 'canceled')
       and exists (select 1 from order_items i left join products pp on pp.id = i.product_id where i.order_id = o.id and pp.fee_type is null and i.status <> 'canceled')
     order by o.created_at limit 1;
    if v_target_order is null then
      insert into orders (table_id, store_id, status, order_type, total, customer_name)
      values (p_target_table_id, p_store_id, v_item.order_status, 'table', 0, v_item.customer_name)
      returning id into v_target_order;
    end if;

    update order_items set order_id = v_target_order where id = v_item.id;
    update orders set total = total + v_item.price_at_time * v_item.quantity, updated_at = now() where id = v_target_order;
    update orders set total = greatest(total - v_item.price_at_time * v_item.quantity, 0), updated_at = now() where id = v_item.order_id;

    select number into v_src_num from tables where id = v_item.src_table;
    insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
    values (p_store_id, (select id from store_users where id = p_operator_user_id), coalesce(p_operator_name, 'Operador'), 'item_transferido',
            jsonb_build_object('produto', coalesce(v_item.pname, 'Produto'), 'quantidade', v_item.quantity,
                               'valor', v_item.price_at_time * v_item.quantity, 'de_mesa', v_src_num, 'para_mesa', v_target.number));
    v_src_orders := v_src_orders || v_item.order_id;
    v_moved := v_moved + 1;
    v_total_moved := v_total_moved + v_item.price_at_time * v_item.quantity;
    v_target_order := null;
  end loop;

  -- Pedido de origem que ficou sem nenhum item é removido (só os pedidos desta transferência).
  delete from orders o
   where o.id = any(v_src_orders)
     and not exists (select 1 from order_items i where i.order_id = o.id);

  if v_moved = 0 then
    return jsonb_build_object('success', false, 'message', 'Nenhum item pôde ser movido (já cancelado, taxa ou na mesma mesa).');
  end if;
  if v_target.status = 'available' then
    update tables set status = 'occupied' where id = p_target_table_id;
    if not exists (select 1 from table_sessions where table_id = p_target_table_id and closed_at is null) then
      insert into table_sessions (table_id, store_id, host_name) values (p_target_table_id, p_store_id, p_operator_name);
    end if;
  end if;
  return jsonb_build_object('success', true, 'moved', v_moved, 'valor', v_total_moved);
end;
$$;
grant execute on function public.transfer_items_secure(uuid, uuid[], uuid, uuid, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
