-- 161: regra do Sertão "garçom não troca mesa nem cancela item, só o gerente" valendo TAMBÉM para os apps antigos
-- (1.2.83/1.2.84 chamam as funções antigas direto, sem checagem de papel). Aditiva no comportamento das v2.
-- Ligar por loja: update stores set config = config || '{"trocas_so_app_novo": true}' where id = ...;
begin;
CREATE OR REPLACE FUNCTION public.cancel_order_item_secure(p_item_id uuid, p_operator_user_id uuid DEFAULT NULL::uuid, p_operator_name text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_store_id uuid;
  v_prev_status text;
  v_qty int;
  v_price numeric;
  v_product_name text;
begin
  -- 161: a função antiga (apps até 1.2.84 ainda a chamam direto) também confere a permissão de quem cancela.
  -- A v2 chama esta com o mesmo operador, então 'cancelar_pedido' (supervisor de caixa pela v2) continua valendo.
  if not (operator_can_secure((select store_id from order_items where id = p_item_id), p_operator_user_id, 'cancelar_item')
       or operator_can_secure((select store_id from order_items where id = p_item_id), p_operator_user_id, 'cancelar_pedido')) then
    raise exception 'Sem permissão: só o gerente cancela item.';
  end if;
  select oi.status, oi.quantity, oi.price_at_time, p.name
    into v_prev_status, v_qty, v_price, v_product_name
    from order_items oi left join products p on p.id = oi.product_id
   where oi.id = p_item_id;

  -- Cancelar duas vezes não grava duas ocorrências nem infla o relatório.
  update order_items set status = 'canceled' where id = p_item_id and status <> 'canceled'
  returning store_id into v_store_id;

  if v_store_id is not null then
    insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
    values (v_store_id, (select id from store_users where id = p_operator_user_id), coalesce(p_operator_name, 'Operador'), 'item_cancelado',
            jsonb_build_object('produto', coalesce(v_product_name, 'Produto indisponível'),
                               'quantidade', v_qty, 'valor', coalesce(v_price, 0) * coalesce(v_qty, 1),
                               'status_anterior', v_prev_status,
                               'motivo', nullif(btrim(coalesce(p_reason, '')), '')));
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_items_secure(p_store_id uuid, p_item_ids uuid[], p_target_table_id uuid, p_operator_user_id uuid DEFAULT NULL::uuid, p_operator_name text DEFAULT NULL::text, p_from_table_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_target tables%rowtype;
  v_item record;
  v_src_num int;
  v_total_moved numeric := 0;
  v_moved int := 0;
  v_target_order uuid;
  v_src_orders uuid[] := '{}';
begin
  -- 161: a função antiga também confere a permissão (apps até 1.2.84 a chamam direto).
  if not operator_can_secure(p_store_id, p_operator_user_id, 'mover_item') then
    return jsonb_build_object('success', false, 'message', 'Sem permissão: só o gerente move item de mesa.');
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.move_table_secure(p_source_table_id uuid, p_target_table_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_target_status text;
  v_source record;
  v_new_pin text;
begin
  -- 161: esta função não sabe QUEM troca a mesa. Em loja com config.trocas_so_app_novo = true, só aceita quando vem
  -- da move_table_v2 (que confere o gerente e marca ntb.trocar_mesa_ok nesta transação). Apps antigos: "atualize o app".
  if coalesce(current_setting('ntb.trocar_mesa_ok', true), '') <> '1'
     and exists (select 1 from tables tt join stores ss on ss.id = tt.store_id
                  where tt.id = p_source_table_id and coalesce(ss.config->>'trocas_so_app_novo', 'false') = 'true') then
    return jsonb_build_object('success', false, 'message', 'Troca de mesa só pelo app atualizado (gerente). Toque em Atualizar agora.');
  end if;
  select status into v_target_status from tables where id = p_target_table_id;
  if v_target_status is null then
    return jsonb_build_object('success', false, 'message', 'Mesa de destino não encontrada.');
  end if;
  if v_target_status != 'available' then
    return jsonb_build_object('success', false, 'message', 'Mesa de destino não está disponível.');
  end if;

  select * into v_source from tables where id = p_source_table_id;
  if v_source is null then
    return jsonb_build_object('success', false, 'message', 'Mesa de origem não encontrada.');
  end if;

  update orders set table_id = p_target_table_id
  where table_id = p_source_table_id and status not in ('delivered', 'canceled');

  update tables set
    status = v_source.status,
    current_host_name = v_source.current_host_name,
    waiter_requested = v_source.waiter_requested,
    guest_count = v_source.guest_count
  where id = p_target_table_id;

  v_new_pin := lpad(floor(random() * 9000 + 1000)::text, 4, '0');
  update tables set
    status = 'available', current_host_name = null, waiter_requested = false, guest_count = 0, pin = v_new_pin
  where id = p_source_table_id;

  update table_sessions set table_id = p_target_table_id
  where table_id = p_source_table_id and closed_at is null;

  return jsonb_build_object('success', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.move_table_v2(p_source_table_id uuid, p_target_table_id uuid, p_operator_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_store uuid; v_store_t uuid;
begin
  select store_id into v_store from tables where id = p_source_table_id;
  select store_id into v_store_t from tables where id = p_target_table_id;
  if v_store is null or v_store is distinct from v_store_t then
    return jsonb_build_object('success', false, 'message', 'Mesa inválida.');
  end if;
  if not operator_can_secure(v_store, p_operator_user_id, 'trocar_mesa') then
    return jsonb_build_object('success', false, 'message', 'Sem permissão: só o gerente (ou quem tem a permissão de trocas) troca de mesa.');
  end if;
  perform set_config('ntb.trocar_mesa_ok', '1', true);
  return move_table_secure(p_source_table_id, p_target_table_id);
end;
$function$;

notify pgrst, 'reload schema';
commit;
