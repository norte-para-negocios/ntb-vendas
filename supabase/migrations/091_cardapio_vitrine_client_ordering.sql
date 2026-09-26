-- 091: Cardápio vitrine (pedido do Ramon/Sertão, 2026-09-26).
-- stores.config.client_ordering (jsonb, ausente = true). Com false, o
-- cardápio do cliente vira só consulta (ClientModule.tsx) e o servidor
-- recusa: (1) open_table_session (usada só pelo cliente) e (2)
-- create_order_secure com p_added_by_role = 'cliente'. Corpos copiados da
-- definição viva no Contabo em 2026-09-26, só com o bloco novo acrescentado.
-- Mesmas assinaturas (CREATE OR REPLACE substitui, não cria overload).

CREATE OR REPLACE FUNCTION public.open_table_session(p_table_id uuid, p_host_name text, p_pin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Cardápio vitrine (091): loja com client_ordering=false não abre sessão
  -- de mesa pelo cliente. open_table_session só é chamada pelo cardápio do
  -- cliente (/c/[slug]); garçom/lojista abrem mesa por outro caminho.
  if coalesce((v_store.config->>'client_ordering')::boolean, true) = false then
    return jsonb_build_object('success', false, 'message', 'Esta loja recebe pedidos só pelo garçom.');
  end if;

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
$function$;

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

  -- Cardápio vitrine (091): pedido de CLIENTE recusado quando a loja
  -- desligou client_ordering. Garçom/lojista sempre mandam 'garcom' (nunca
  -- afetados). Não é barreira contra quem forja o role (a function já não
  -- autentica ninguém) — fecha o caminho do app do cliente/sessão antiga.
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

NOTIFY pgrst, 'reload schema';
