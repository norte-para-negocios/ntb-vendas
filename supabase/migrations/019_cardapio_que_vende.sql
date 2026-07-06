-- Cardapio que vende (2026-07-06): preco promocional, destaque e
-- etiquetas por produto -- tudo configuravel pelo LOJISTA no proprio
-- formulario de produto (requisito explicito do usuario), nada no Master
-- Admin. Chips de observacao ficam em stores.config (jsonb ja existente),
-- sem coluna nova.

alter table products add column if not exists promo_price numeric(10,2);
alter table products add column if not exists featured boolean not null default false;
alter table products add column if not exists tags text[] not null default '{}';

-- Promocao so vale se for menor que o preco cheio (CHECK evita promocao
-- "maior que o preco", que seria so confusao/bug de cadastro).
alter table products drop constraint if exists products_promo_price_check;
alter table products add constraint products_promo_price_check
  check (promo_price is null or (promo_price >= 0 and promo_price < price));

-- ─── create_order_secure: cobra o preco promocional NO SERVIDOR ───────────────
-- Mesmo principio de sempre (007/016/017): o client nunca dita preco.
-- Se promo_price estiver setado (e o CHECK acima ja garante < price), o
-- preco efetivo do item vira promo_price. coalesce cobre o caso normal.
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
  v_preco_efetivo numeric;
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
      v_selected_options := v_selected_options || jsonb_build_object('name', v_option.name, 'price_delta', v_option.price_delta);
    end loop;

    v_line_total := (v_preco_efetivo + v_options_delta) * (v_item->>'quantity')::int;
    v_total := v_total + v_line_total;

    insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, selected_options)
    values (
      v_order_id, v_product.id, (v_item->>'quantity')::int, 'pending', v_item->>'notes',
      v_preco_efetivo + v_options_delta, v_selected_options
    );
  end loop;

  update orders set total = total + v_total where id = v_order_id;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end;
$$;

grant execute on function public.create_order_secure(uuid, uuid, text, text, jsonb) to anon, authenticated;
