-- 138: taxas como produto (pedido do dono/Ramon, 2026-10-01).
--
-- No Omie do Sertão as taxas são produtos da família "TAXAS / DELIVERY"
-- (Taxa de Serviço 90875, Taxa de Rolha 90383, Taxa de Troca 90809, Couvert
-- 90656, Taxa Frete 7..55 = 90345..90353). No sistema antigo a taxa de 10% saía
-- na NFC-e como item ("Taxa de Servico", qtd 1, ~10% do resto da conta). Aqui
-- a taxa vira produto do cardápio com `fee_type`:
--   'fixed'   = valor do próprio produto (rolha, troca, frete);
--   'percent' = `fee_percent` % sobre os itens da conta (taxa de serviço).
-- Taxa NUNCA entra por create_order_secure (cliente/garçom); só pelo caixa,
-- via add_fee_item_secure, que calcula o preço no servidor. Vira item comum
-- da conta (status 'delivered', nunca imprime em cozinha/bar), então vai pra
-- nota fiscal e pro Estoque/Omie pelo fluxo de sempre.
--
-- Regra anti-cobrança dupla: lançar a taxa percentual marca
-- tables.service_fee_removed = true (o cálculo automático de 10% some; o item
-- passa a ser a taxa). O app também ignora o automático quando a conta tem
-- item de taxa percentual (lib/taxas.ts).
--
-- Aditiva: colunas novas nullable, functions novas, create_order_secure
-- recriada com a mesma assinatura (só ganhou a recusa de produto-taxa; nenhum
-- produto tem fee_type antes desta migration). Fechamento do turno: ver 139.

alter table products add column if not exists fee_type text;
alter table products add column if not exists fee_percent numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_fee_type_check') then
    alter table products add constraint products_fee_type_check
      check (fee_type is null or fee_type in ('fixed', 'percent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_fee_percent_check') then
    alter table products add constraint products_fee_percent_check
      check (
        (fee_type = 'percent' and fee_percent is not null and fee_percent > 0 and fee_percent <= 100)
        or (coalesce(fee_type, '') <> 'percent' and fee_percent is null)
      );
  end if;
end $$;

-- create_order_secure: igual à 091, só recusa produto-taxa.
CREATE OR REPLACE FUNCTION public.create_order_secure(p_table_id uuid, p_store_id uuid, p_order_type text, p_customer_name text, p_items jsonb, p_added_by_role text DEFAULT 'cliente'::text, p_added_by_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product products%rowtype;
  v_preco_efetivo numeric;
  v_total numeric := 0;
  v_line_total numeric;
  v_option_ids uuid[];
  v_option_id uuid;
  v_option product_options%rowtype;
  v_options_delta numeric;
  v_selected_options jsonb;
begin
  if p_added_by_role not in ('cliente', 'garcom') then
    return jsonb_build_object('success', false, 'message', 'added_by_role inválido.');
  end if;

  if p_added_by_role = 'cliente'
     and exists (select 1 from stores s where s.id = p_store_id
                 and coalesce((s.config->>'client_ordering')::boolean, true) = false) then
    return jsonb_build_object('success', false, 'message', 'Esta loja recebe pedidos só pelo garçom.');
  end if;

  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', 'Pedido sem itens.');
  end if;
  if jsonb_array_length(p_items) > 100 then
    return jsonb_build_object('success', false, 'message', 'Pedido excede o limite de itens.');
  end if;

  if p_order_type = 'table' and p_table_id is not null then
    if not exists (select 1 from tables t where t.id = p_table_id and t.store_id = p_store_id) then
      return jsonb_build_object('success', false, 'message', 'Mesa inválida para esta loja.');
    end if;
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
    -- 138: taxa só entra pelo caixa (add_fee_item_secure).
    if v_product.fee_type is not null then
      raise exception 'Taxa só pode ser lançada pelo caixa, no fechamento da conta.';
    end if;
    if (v_item->>'quantity')::int <= 0 then
      raise exception 'Quantidade inválida.';
    end if;

    v_preco_efetivo := coalesce(v_product.promo_price, v_product.price);

    v_options_delta := 0;
    v_selected_options := '[]'::jsonb;

    select array(
      select distinct (elem)::uuid
      from jsonb_array_elements_text(coalesce(v_item->'option_ids', '[]'::jsonb)) as elem
    ) into v_option_ids;

    if coalesce(array_length(v_option_ids, 1), 0) > 30 then
      raise exception 'Número de adicionais inválido.';
    end if;

    foreach v_option_id in array v_option_ids
    loop
      select po.* into v_option
      from product_options po
      join product_option_groups pog on pog.id = po.group_id
      where po.id = v_option_id and pog.product_id = v_product.id and po.available = true;

      if not found then
        raise exception 'Opção inválida ou indisponível para este produto.';
      end if;

      v_options_delta := v_options_delta + v_option.price_delta;
      v_selected_options := v_selected_options || jsonb_build_object(
        'name', v_option.name,
        'price_delta', v_option.price_delta,
        'omie_codigo', v_option.omie_codigo
      );
    end loop;

    v_line_total := (v_preco_efetivo + v_options_delta) * (v_item->>'quantity')::int;
    v_total := v_total + v_line_total;

    insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, selected_options, added_by_role, added_by_name)
    values (
      v_order_id, v_product.id, (v_item->>'quantity')::int, 'pending', v_item->>'notes',
      v_preco_efetivo + v_options_delta, v_selected_options, p_added_by_role,
      case when p_added_by_role = 'garcom' then p_added_by_name else null end
    );
  end loop;

  update orders set total = total + v_total where id = v_order_id;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end;
$function$;

-- Marca/desmarca um produto como taxa (formulário de produto do cardápio).
-- Separada de update_product_secure pra não mudar a assinatura dela.
create or replace function public.set_product_fee_secure(
  p_product_id uuid, p_store_id uuid, p_fee_type text, p_fee_percent numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from products where id = p_product_id and store_id = p_store_id) then
    raise exception 'Produto inválido para esta loja.';
  end if;
  if p_fee_type is not null and p_fee_type not in ('fixed', 'percent') then
    raise exception 'Tipo de taxa inválido.';
  end if;
  update products set
    fee_type = p_fee_type,
    fee_percent = case when p_fee_type = 'percent' then p_fee_percent else null end
  where id = p_product_id and store_id = p_store_id;
end;
$$;
grant execute on function public.set_product_fee_secure(uuid, uuid, text, numeric) to anon, authenticated;

-- Lança uma taxa na conta da mesa. Só quem tem permissão de caixa (dono,
-- permissions.caixa = true, ou conta universal). Preço sempre do servidor:
--   fixa      = coalesce(promo_price, price) x quantidade;
--   percentual= round(soma dos itens não-taxa e não-cancelados da conta x %, 2),
--               quantidade 1. Se a conta já tem essa taxa percentual, RECALCULA
--               a linha existente (nunca duplica).
-- A taxa vai num pedido próprio da mesa com status 'accepted' (nunca 'pending':
-- create_order_secure reaproveitaria e send_order_to_kitchen_secure mandaria o
-- item pra impressão). O item nasce 'delivered' (fora do KDS/impressão).
create or replace function public.add_fee_item_secure(
  p_store_id uuid,
  p_table_id uuid,
  p_product_id uuid,
  p_quantity int default 1,
  p_operator_user_id uuid default null,
  p_operator_name text default null)
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
  v_exist_id uuid;
  v_exist_order uuid;
  v_exist_price numeric;
  v_order_id uuid;
  v_item_id uuid;
begin
  select * into v_product from products where id = p_product_id and store_id = p_store_id;
  if not found or v_product.fee_type is null then
    return jsonb_build_object('success', false, 'message', 'Taxa inválida para esta loja.');
  end if;
  if not exists (select 1 from tables t where t.id = p_table_id and t.store_id = p_store_id) then
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

  if v_product.fee_type = 'percent' then
    select coalesce(sum(oi.price_at_time * oi.quantity), 0) into v_base
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = oi.product_id
     where o.table_id = p_table_id and o.store_id = p_store_id
       and o.status not in ('delivered', 'canceled')
       and oi.status <> 'canceled'
       and p.fee_type is null;
    v_price := round(v_base * v_product.fee_percent / 100, 2);
    v_qty := 1;
    if v_price <= 0 then
      return jsonb_build_object('success', false, 'message', 'A conta não tem itens pra calcular a taxa.');
    end if;

    select oi.id, oi.order_id, oi.price_at_time into v_exist_id, v_exist_order, v_exist_price
      from order_items oi
      join orders o on o.id = oi.order_id
     where o.table_id = p_table_id and o.store_id = p_store_id
       and o.status not in ('delivered', 'canceled')
       and oi.status <> 'canceled'
       and oi.product_id = p_product_id
     limit 1;
    if v_exist_id is not null then
      update order_items set price_at_time = v_price where id = v_exist_id;
      update orders set total = total - v_exist_price + v_price, updated_at = now() where id = v_exist_order;
      update tables set service_fee_removed = true where id = p_table_id;
      return jsonb_build_object('success', true, 'item_id', v_exist_id, 'price', v_price, 'updated', true);
    end if;
  else
    v_qty := coalesce(p_quantity, 1);
    if v_qty < 1 or v_qty > 99 then
      return jsonb_build_object('success', false, 'message', 'Quantidade inválida.');
    end if;
    v_price := coalesce(v_product.promo_price, v_product.price);
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

  insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, selected_options, added_by_role, added_by_name)
  values (v_order_id, p_product_id, v_qty, 'delivered', null, v_price, '[]'::jsonb, 'garcom', p_operator_name)
  returning id into v_item_id;

  update orders set total = total + v_price * v_qty, updated_at = now() where id = v_order_id;

  if v_product.fee_type = 'percent' then
    update tables set service_fee_removed = true where id = p_table_id;
  end if;

  return jsonb_build_object('success', true, 'item_id', v_item_id, 'price', v_price, 'updated', false);
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end;
$$;
grant execute on function public.add_fee_item_secure(uuid, uuid, uuid, int, uuid, text) to anon, authenticated;

NOTIFY pgrst, 'reload schema';
