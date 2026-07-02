-- Track M / Task M1 — hardening de pedidos: rate-limit de PIN, preco
-- validado no servidor, CHECK constraints. Ver varredura de 2026-07-02.

alter table tables add column if not exists pin_attempts int not null default 0;
alter table tables add column if not exists pin_locked_until timestamptz;

create or replace function public.open_table_session(
  p_table_id uuid,
  p_host_name text,
  p_pin text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table tables%rowtype;
  v_store stores%rowtype;
  v_pin_required boolean;
  v_is_host boolean;
begin
  select * into v_table from tables where id = p_table_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Mesa não encontrada.');
  end if;

  if v_table.status = 'blocked' then
    return jsonb_build_object('success', false, 'message', 'Esta mesa está bloqueada.');
  end if;

  if v_table.pin_locked_until is not null and v_table.pin_locked_until > now() then
    return jsonb_build_object('success', false, 'message', 'Muitas tentativas de PIN incorreto. Tente novamente em alguns minutos.');
  end if;

  select * into v_store from stores where id = v_table.store_id;

  v_pin_required := (v_table.status <> 'available')
                     or coalesce((v_store.config->>'require_pin_for_open')::boolean, false);

  if v_pin_required and (p_pin is null or p_pin <> v_table.pin) then
    update tables set
      pin_attempts = pin_attempts + 1,
      pin_locked_until = case when pin_attempts + 1 >= 5 then now() + interval '5 minutes' else pin_locked_until end
    where id = p_table_id;

    return jsonb_build_object(
      'success', false,
      'message', case when v_table.status <> 'available'
                      then 'Mesa já ocupada! Peça o PIN ao anfitrião.'
                      else 'PIN incorreto.' end
    );
  end if;

  update tables set pin_attempts = 0, pin_locked_until = null where id = p_table_id;

  if v_table.status = 'available' then
    update tables set status = 'occupied', current_host_name = p_host_name where id = p_table_id;
    v_is_host := true;
    v_table.current_host_name := p_host_name;
  else
    v_is_host := (lower(v_table.current_host_name) = lower(p_host_name));
  end if;

  return jsonb_build_object(
    'success', true,
    'is_host', v_is_host,
    'table', jsonb_build_object(
      'id', v_table.id,
      'store_id', v_table.store_id,
      'number', v_table.number,
      'status', case when v_table.status = 'available' then 'occupied' else v_table.status end,
      'current_host_name', v_table.current_host_name,
      'guest_count', v_table.guest_count,
      'waiter_requested', v_table.waiter_requested,
      'service_fee_removed', v_table.service_fee_removed,
      'pin', case when v_is_host then v_table.pin else null end
    )
  );
end;
$$;

grant execute on function public.open_table_session(uuid, text, text) to anon, authenticated;

-- ─── Pedido com preço validado no servidor ────────────────────────────────────
create or replace function public.create_order_secure(
  p_table_id uuid,
  p_store_id uuid,
  p_order_type text,
  p_customer_name text,
  p_items jsonb -- [{product_id, quantity, notes}]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product products%rowtype;
  v_total numeric := 0;
  v_line_total numeric;
begin
  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', 'Pedido sem itens.');
  end if;

  -- Pedido de mesa reaproveita um pedido 'pending' já aberto na mesma mesa
  -- (mesmo comportamento do insert direto que isso substitui) — sem isso,
  -- cada "enviar pedido" na mesma mesa vira uma linha nova em `orders`,
  -- inflando contagem de vendas/ticket médio no dashboard. Balcão sempre
  -- cria pedido novo (nunca teve essa reutilização).
  if p_order_type = 'table' and p_table_id is not null then
    select id into v_order_id from orders
    where table_id = p_table_id and status = 'pending'
    limit 1;
  end if;

  if v_order_id is null then
    insert into orders (table_id, store_id, status, order_type, total, customer_name)
    values (p_table_id, p_store_id, 'pending', p_order_type, 0, p_customer_name)
    returning id into v_order_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_product from products where id = (v_item->>'product_id')::uuid and store_id = p_store_id;
    if not found then
      raise exception 'Produto inválido para esta loja.';
    end if;
    if (v_item->>'quantity')::int <= 0 then
      raise exception 'Quantidade inválida.';
    end if;

    v_line_total := v_product.price * (v_item->>'quantity')::int;
    v_total := v_total + v_line_total;

    insert into order_items (order_id, product_id, quantity, status, notes, price_at_time)
    values (v_order_id, v_product.id, (v_item->>'quantity')::int, 'pending', v_item->>'notes', v_product.price);
  end loop;

  -- Soma ao total existente (não sobrescreve) — o pedido pode já ter itens
  -- de uma chamada anterior, se foi reaproveitado acima.
  update orders set total = total + v_total where id = v_order_id;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end;
$$;

grant execute on function public.create_order_secure(uuid, uuid, text, text, jsonb) to anon, authenticated;

-- ─── CHECK constraints ─────────────────────────────────────────────────────────
alter table products drop constraint if exists products_price_check;
alter table products add constraint products_price_check check (price >= 0);

alter table order_items drop constraint if exists order_items_quantity_check;
alter table order_items add constraint order_items_quantity_check check (quantity > 0);

alter table order_items drop constraint if exists order_items_price_check;
alter table order_items add constraint order_items_price_check check (price_at_time >= 0);
