-- 150: relatório de exceções + motivo obrigatório no cancelamento (2026-10-04, plano próximas features).
-- 1) cash_shift_audit_events aceita mais tipos: taxa_editada, taxa_removida, item_transferido, nota_cancelada.
-- 2) cancel_order_item_secure ganha p_reason e grava motivo, quantidade, valor e status anterior do item.
-- 3) add_fee_item_secure (141) passa a gravar taxa_editada/taxa_removida (quem, de quanto pra quanto).
-- 4) fetch_exceptions_report_secure: agregado por operador + últimos eventos + notas fiscais canceladas no período.
alter table cash_shift_audit_events drop constraint if exists cash_shift_audit_events_event_type_check;
alter table cash_shift_audit_events add constraint cash_shift_audit_events_event_type_check
  check (event_type in ('item_cancelado', 'sangria_grande', 'tolerancia_excedida', 'pagamento_estornado',
                        'taxa_editada', 'taxa_removida', 'item_transferido', 'nota_cancelada'));

drop function if exists public.cancel_order_item_secure(uuid, uuid, text);
create function public.cancel_order_item_secure(
  p_item_id uuid,
  p_operator_user_id uuid default null,
  p_operator_name text default null,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid;
  v_prev_status text;
  v_qty int;
  v_price numeric;
  v_product_name text;
begin
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
$$;
grant execute on function public.cancel_order_item_secure(uuid, uuid, text, text) to anon, authenticated;

drop function if exists public.add_fee_item_secure(uuid, uuid, uuid, int, uuid, text, numeric, numeric);
create or replace function public.add_fee_item_secure(
  p_store_id uuid,
  p_table_id uuid,
  p_product_id uuid,
  p_quantity int default 1,
  p_operator_user_id uuid default null,
  p_operator_name text default null,
  p_amount numeric default null,
  p_percent numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_product products%rowtype;
  v_pode boolean;
  v_base numeric;
  v_price numeric;
  v_qty int;
  v_manual boolean := false;
  v_manual_pct numeric := null;
  v_exist_id uuid;
  v_exist_order uuid;
  v_exist_price numeric;
  v_exist_manual boolean;
  v_exist_manual_pct numeric;
  v_order_id uuid;
  v_item_id uuid;
begin
  select * into v_product from products where id = p_product_id and store_id = p_store_id;
  if not found or v_product.fee_type is null then
    return jsonb_build_object('success', false, 'message', 'Taxa inválida para esta loja.');
  end if;
  -- Trava a mesa: dois toques seguidos não duplicam o item.
  perform 1 from tables t where t.id = p_table_id and t.store_id = p_store_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Mesa inválida para esta loja.');
  end if;

  -- Permissão de caixa (mesma regra do app: lib/taxas.ts podeLancarTaxa).
  if p_operator_user_id is null then
    return jsonb_build_object('success', false, 'message', 'Só quem tem permissão de caixa pode lançar taxa.');
  end if;
  select (su.role = 'owner' or coalesce((su.permissions->>'caixa')::boolean, false))
    into v_pode
    from store_users su where su.id = p_operator_user_id and su.store_id = p_store_id;
  if v_pode is null then
    v_pode := exists (select 1 from universal_users u where u.id = p_operator_user_id);
  end if;
  if not coalesce(v_pode, false) then
    return jsonb_build_object('success', false, 'message', 'Só quem tem permissão de caixa pode lançar taxa.');
  end if;

  if not exists (select 1 from orders o where o.table_id = p_table_id and o.store_id = p_store_id
                   and o.status not in ('delivered', 'canceled')) then
    return jsonb_build_object('success', false, 'message', 'Mesa sem conta aberta.');
  end if;

  if p_amount is not null and p_percent is not null then
    return jsonb_build_object('success', false, 'message', 'Informe o valor OU o percentual, não os dois.');
  end if;
  if p_amount is not null and p_amount < 0 then
    return jsonb_build_object('success', false, 'message', 'Valor da taxa não pode ser negativo.');
  end if;
  if p_percent is not null and (p_percent < 0 or p_percent > 100) then
    return jsonb_build_object('success', false, 'message', 'Percentual da taxa deve ficar entre 0 e 100.');
  end if;

  if v_product.fee_type = 'percent' then
    select coalesce(sum(oi.price_at_time * oi.quantity), 0) into v_base
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = oi.product_id
     where o.table_id = p_table_id and o.store_id = p_store_id
       and o.status not in ('delivered', 'canceled')
       and oi.status <> 'canceled'
       and p.fee_type is null;
    v_base := round(v_base, 2);
    v_qty := 1;

    select oi.id, oi.order_id, oi.price_at_time, oi.fee_manual, oi.fee_manual_percent
      into v_exist_id, v_exist_order, v_exist_price, v_exist_manual, v_exist_manual_pct
      from order_items oi
      join orders o on o.id = oi.order_id
     where o.table_id = p_table_id and o.store_id = p_store_id
       and o.status not in ('delivered', 'canceled')
       and oi.status <> 'canceled'
       and oi.product_id = p_product_id
     limit 1;

    if p_amount is not null then
      v_manual := true;
      v_price := round(p_amount, 2);
      if v_price > v_base then
        return jsonb_build_object('success', false, 'message', 'A taxa não pode ser maior que o total da conta (R$ ' || replace(to_char(v_base, 'FM999999990.00'), '.', ',') || ').');
      end if;
    elsif p_percent is not null then
      v_manual := true;
      v_manual_pct := p_percent;
      v_price := round(v_base * p_percent / 100, 2);
    elsif coalesce(v_exist_manual, false) then
      -- Recálculo sem valor novo sobre item já editado: percentual editado recalcula com ELE;
      -- valor digitado em R$ fica como está.
      v_manual := true;
      if v_exist_manual_pct is null then
        return jsonb_build_object('success', true, 'item_id', v_exist_id, 'price', v_exist_price, 'updated', false);
      end if;
      v_manual_pct := v_exist_manual_pct;
      v_price := round(v_base * v_manual_pct / 100, 2);
    else
      v_price := round(v_base * v_product.fee_percent / 100, 2);
    end if;

    if v_manual and v_price = 0 then
      -- Taxa zerada = sem taxa de serviço (igual "Tirar a taxa"): tira o item e marca a mesa.
      if v_exist_id is not null then
        delete from order_items where id = v_exist_id;
        update orders set total = greatest(total - v_exist_price, 0), updated_at = now() where id = v_exist_order;
        if not exists (select 1 from order_items where order_id = v_exist_order) then
          delete from orders where id = v_exist_order;
        end if;
      end if;
      update tables set service_fee_removed = true where id = p_table_id;
      insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
      values (p_store_id, (select id from store_users where id = p_operator_user_id), coalesce(p_operator_name, 'Operador'), 'taxa_removida',
              jsonb_build_object('produto', v_product.name, 'valor', coalesce(v_exist_price, 0)));
      return jsonb_build_object('success', true, 'item_id', null, 'price', 0, 'updated', v_exist_id is not null, 'removed', true);
    end if;
    if v_price <= 0 then
      return jsonb_build_object('success', false, 'message', 'A conta não tem itens pra calcular a taxa.');
    end if;

    if v_exist_id is not null then
      update order_items set price_at_time = v_price, fee_manual = v_manual, fee_manual_percent = v_manual_pct
       where id = v_exist_id;
      update orders set total = total - v_exist_price + v_price, updated_at = now() where id = v_exist_order;
      update tables set service_fee_removed = true where id = p_table_id;
      if v_manual then
        insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
        values (p_store_id, (select id from store_users where id = p_operator_user_id), coalesce(p_operator_name, 'Operador'), 'taxa_editada',
                jsonb_build_object('produto', v_product.name, 'de', v_exist_price, 'para', v_price, 'valor', abs(v_exist_price - v_price)));
      end if;
      return jsonb_build_object('success', true, 'item_id', v_exist_id, 'price', v_price, 'updated', true);
    end if;
  else
    if p_percent is not null then
      return jsonb_build_object('success', false, 'message', 'Esta taxa é de valor fixo: informe o valor em R$.');
    end if;
    v_qty := coalesce(p_quantity, 1);
    if v_qty < 1 or v_qty > 99 then
      return jsonb_build_object('success', false, 'message', 'Quantidade inválida.');
    end if;
    if p_amount is not null then
      if p_amount <= 0 or p_amount > 5000 then
        return jsonb_build_object('success', false, 'message', 'Valor da taxa deve ficar entre R$ 0,01 e R$ 5.000,00.');
      end if;
      v_manual := true;
      v_price := round(p_amount, 2);
    else
      v_price := coalesce(v_product.promo_price, v_product.price);
    end if;
  end if;

  -- Reaproveita o pedido de taxas aberto da mesa (só tem item-taxa), senão cria.
  select o.id into v_order_id
    from orders o
   where o.table_id = p_table_id and o.store_id = p_store_id and o.status = 'accepted'
     and exists (select 1 from order_items oi where oi.order_id = o.id)
     and not exists (
       select 1 from order_items oi left join products p on p.id = oi.product_id
        where oi.order_id = o.id and p.fee_type is null)
   limit 1;
  if v_order_id is null then
    insert into orders (table_id, store_id, status, order_type, total, customer_name)
    values (p_table_id, p_store_id, 'accepted', 'table', 0, null)
    returning id into v_order_id;
  end if;

  insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, selected_options, added_by_role, added_by_name, fee_manual, fee_manual_percent)
  values (v_order_id, p_product_id, v_qty, 'delivered', null, v_price, '[]'::jsonb, 'garcom', p_operator_name, v_manual, v_manual_pct)
  returning id into v_item_id;

  update orders set total = total + v_price * v_qty, updated_at = now() where id = v_order_id;

  if v_product.fee_type = 'percent' then
    update tables set service_fee_removed = true where id = p_table_id;
  end if;

  if v_manual then
    insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
    values (p_store_id, (select id from store_users where id = p_operator_user_id), coalesce(p_operator_name, 'Operador'), 'taxa_editada',
            jsonb_build_object('produto', v_product.name, 'de', coalesce(v_product.promo_price, v_product.price), 'para', v_price, 'valor', abs(coalesce(v_product.promo_price, v_product.price) - v_price)));
  end if;

  return jsonb_build_object('success', true, 'item_id', v_item_id, 'price', v_price, 'updated', false);
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end;
$$;
grant execute on function public.add_fee_item_secure(uuid, uuid, uuid, int, uuid, text, numeric, numeric) to anon, authenticated;

-- Relatório de exceções do período (só leitura; o app restringe a tela a dono/gerente/supervisor).
create or replace function public.fetch_exceptions_report_secure(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with ev as (
    select e.operator_name, e.event_type, e.created_at, e.details,
           case when (e.details->>'valor') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e.details->>'valor')::numeric else 0 end as valor
      from cash_shift_audit_events e
     where e.store_id = p_store_id and e.created_at >= p_from and e.created_at < p_to
  )
  select jsonb_build_object(
    'by_operator', coalesce((
      select jsonb_agg(x order by x->>'operator_name') from (
        select jsonb_build_object('operator_name', operator_name,
                 'counts', jsonb_object_agg(event_type, n),
                 'values', jsonb_object_agg(event_type, v)) as x
          from (select operator_name, event_type, count(*) n, round(sum(valor), 2) v from ev group by 1, 2) g
         group by operator_name) y), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
        select operator_name, event_type, created_at, details from ev order by created_at desc limit 200) t), '[]'::jsonb),
    'notas_canceladas', (
      select jsonb_build_object('count', count(*), 'valor', coalesce(round(sum(valor_total), 2), 0))
        from fiscal_notas where store_id = p_store_id and status = 'cancelada' and cancelada_em >= p_from and cancelada_em < p_to)
  );
$$;
grant execute on function public.fetch_exceptions_report_secure(uuid, timestamptz, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
