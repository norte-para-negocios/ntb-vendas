-- Amadurece "Adicionais/opcionais de produto" (016) rumo a virar um recurso
-- padrão de verdade (não só testado numa loja): min/max de seleção em
-- grupo multiple, disponibilidade por opção, sync atômico (era apaga+
-- recria via várias chamadas REST separadas, sem transação — falha no
-- meio perdia grupos silenciosamente), e trava contra abuso via
-- option_ids duplicado/sem limite no create_order_secure (achado: um
-- client malicioso podia repetir o mesmo option_id válido milhares de
-- vezes numa única chamada RPC pública, sem autenticação, forçando
-- milhares de round-trips de query). Ver varredura de 2026-07-05.

alter table product_option_groups add column if not exists min_select int;
alter table product_option_groups add column if not exists max_select int;
-- min/max só se aplicam a type='multiple' (single já é 0 ou 1 por natureza
-- do radio button). NULL = sem limite (comportamento atual preservado).

alter table product_options add column if not exists available boolean not null default true;

-- ─── Sync atômico (substitui múltiplas chamadas REST separadas do client) ──
create or replace function public.sync_product_option_groups(
  p_product_id uuid,
  p_groups jsonb -- [{name, type, required, min_select, max_select, options:[{name, price_delta, available}]}]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group jsonb;
  v_option jsonb;
  v_group_id uuid;
  v_group_order int := 0;
  v_option_order int;
begin
  delete from product_option_groups where product_id = p_product_id; -- cascade cuida de product_options

  for v_group in select * from jsonb_array_elements(p_groups)
  loop
    if coalesce(trim(v_group->>'name'), '') = '' then continue; end if;

    insert into product_option_groups (product_id, name, type, required, min_select, max_select, "order")
    values (
      p_product_id, trim(v_group->>'name'), coalesce(v_group->>'type', 'single'),
      coalesce((v_group->>'required')::boolean, false),
      nullif(v_group->>'min_select', '')::int, nullif(v_group->>'max_select', '')::int,
      v_group_order
    )
    returning id into v_group_id;
    v_group_order := v_group_order + 1;

    v_option_order := 0;
    for v_option in select * from jsonb_array_elements(coalesce(v_group->'options', '[]'::jsonb))
    loop
      if coalesce(trim(v_option->>'name'), '') = '' then continue; end if;
      insert into product_options (group_id, name, price_delta, available, "order")
      values (
        v_group_id, trim(v_option->>'name'), coalesce((v_option->>'price_delta')::numeric, 0),
        coalesce((v_option->>'available')::boolean, true), v_option_order
      );
      v_option_order := v_option_order + 1;
    end loop;
  end loop;
end;
$$;

grant execute on function public.sync_product_option_groups(uuid, jsonb) to anon, authenticated;

-- ─── create_order_secure: dedup + limite em option_ids, limite de itens ────
create or replace function public.create_order_secure(
  p_table_id uuid,
  p_store_id uuid,
  p_order_type text,
  p_customer_name text,
  p_items jsonb
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
  v_option_ids uuid[];
  v_option_id uuid;
  v_option product_options%rowtype;
  v_options_delta numeric;
  v_selected_options jsonb;
begin
  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', 'Pedido sem itens.');
  end if;
  if jsonb_array_length(p_items) > 100 then
    return jsonb_build_object('success', false, 'message', 'Pedido excede o limite de itens.');
  end if;

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

    v_options_delta := 0;
    v_selected_options := '[]'::jsonb;

    -- DISTINCT: acha real de 2026-07-05 -- sem isso, option_id repetido no
    -- mesmo item soma o price_delta de novo a cada repeticao (nao deixa o
    -- cliente pagar menos, mas e' um vetor de DoS barato via muitas
    -- repeticoes forcando muitas queries dentro de uma unica chamada RPC
    -- publica sem autenticacao).
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
      v_selected_options := v_selected_options || jsonb_build_object('name', v_option.name, 'price_delta', v_option.price_delta);
    end loop;

    v_line_total := (v_product.price + v_options_delta) * (v_item->>'quantity')::int;
    v_total := v_total + v_line_total;

    insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, selected_options)
    values (
      v_order_id, v_product.id, (v_item->>'quantity')::int, 'pending', v_item->>'notes',
      v_product.price + v_options_delta, v_selected_options
    );
  end loop;

  update orders set total = total + v_total where id = v_order_id;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end;
$$;

grant execute on function public.create_order_secure(uuid, uuid, text, text, jsonb) to anon, authenticated;
