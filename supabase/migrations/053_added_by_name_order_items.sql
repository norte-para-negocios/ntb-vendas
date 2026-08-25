-- Pedido real do Ramon (WhatsApp, 2026-08-24, áudio): "o nome do garçom
-- está cadastrado, porque aí a gente identificaria melhor" — a comanda hoje
-- só mostra um badge genérico "Garçom" nos itens lançados manualmente
-- (order_items.added_by_role = 'garcom', migration 046), sem dizer QUAL
-- garçom. `orders.customer_name` não serve pra isso: quando o garçom lança
-- item numa mesa que já tem pedido pending aberto pelo cliente via QR,
-- create_order_secure reaproveita esse pedido (linha 64-67 da 046) sem
-- tocar `customer_name`, que continua sendo o nome do CLIENTE, não do
-- garçom. Precisa de uma coluna própria por item.
alter table order_items
  add column if not exists added_by_name text;

-- Mesmo achado já documentado nas migrations 033/046: CREATE OR REPLACE
-- não substitui a function quando a lista de parâmetros muda de tamanho
-- (aqui, de 6 pra 7) — precisa do DROP explícito, senão cria um overload
-- novo e o Postgrest passa a recusar a chamada com "could not choose the
-- best candidate function" (achado real, sessão de hoje).
drop function if exists public.create_order_secure(uuid, uuid, text, text, jsonb, text);

create or replace function public.create_order_secure(
  p_table_id uuid,
  p_store_id uuid,
  p_order_type text,
  p_customer_name text,
  p_items jsonb,
  p_added_by_role text default 'cliente',
  p_added_by_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.create_order_secure(uuid, uuid, text, text, jsonb, text, text) to anon, authenticated;
