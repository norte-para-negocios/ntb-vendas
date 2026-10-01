-- 140: pizza com sabores de camadas diferentes (Sertão, pedido do Ramon, 2026-10-01).
--
-- Duas peças novas, ambas ADITIVAS (default = comportamento de sempre):
--
-- 1) product_option_groups.price_rule ('sum' | 'max', default 'sum')
--    'sum' = soma o price_delta das opções escolhidas (como sempre foi).
--    'max' = todas as opções escolhidas em grupos 'max' do MESMO item formam
--    um "pote": só a de maior acréscimo é cobrada; as outras valem 0.
--    Ex.: Sabor 1 = Calabresa (Tradicional, +0) e Sabor 2 = Lampião
--    (Arretada, +10) -> cobra +10 = preço da Arretada. "Vale o sabor mais caro".
--    Empate: vale a primeira na ordem (grupo, opção).
--
-- 2) product_options.variants jsonb (null = sem variação)
--    Valor/código da opção que muda conforme OUTRA escolha do mesmo item,
--    chaveado pelo NOME da opção escolhida no outro grupo. Ex. (sabor Camarão):
--      {"Grande": {"price_delta": 20, "omie_codigo": "90207"},
--       "Média":  {"omie_codigo": "90209"},
--       "Pequena":{"omie_codigo": "90208"}}
--    Campo ausente na variação = usa o da própria opção. Primeira chave que
--    bate (na ordem grupo/opção das outras escolhas) vence.
--
-- Ordem de cálculo (idêntica em lib/calc.ts: resolveSelectedOptions):
--   a) cada opção escolhida resolve variação -> (price_delta, omie_codigo)
--   b) pote 'max': só a maior fica, as outras viram 0
--   c) soma tudo + preço efetivo do produto.
-- O snapshot em order_items.selected_options grava o price_delta JÁ RESOLVIDO
-- (soma do snapshot = price_at_time - preço do produto) e o omie_codigo
-- resolvido — a rota de Ordem de Produção e a impressão não mudam.
--
-- Trocar a regra (ex.: média em vez de maior) = um novo valor no CHECK +
-- o mesmo trecho nas duas funções (create_order_secure e resolveSelectedOptions).

alter table product_option_groups
  add column if not exists price_rule text not null default 'sum';
do $$ begin
  alter table product_option_groups
    add constraint product_option_groups_price_rule_check check (price_rule in ('sum', 'max'));
exception when duplicate_object then null; end $$;

alter table product_options
  add column if not exists variants jsonb;
do $$ begin
  alter table product_options
    add constraint product_options_variants_check check (variants is null or jsonb_typeof(variants) = 'object');
exception when duplicate_object then null; end $$;

-- Sync atômico (017/044) passa a gravar os dois campos novos.
create or replace function public.sync_product_option_groups(p_product_id uuid, p_groups jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_group jsonb;
  v_option jsonb;
  v_group_id uuid;
  v_group_order int := 0;
  v_option_order int;
  v_variants jsonb;
begin
  delete from product_option_groups where product_id = p_product_id; -- cascade cuida de product_options

  for v_group in select * from jsonb_array_elements(p_groups)
  loop
    if coalesce(trim(v_group->>'name'), '') = '' then continue; end if;

    insert into product_option_groups (product_id, name, type, required, min_select, max_select, "order", price_rule)
    values (
      p_product_id, trim(v_group->>'name'), coalesce(v_group->>'type', 'single'),
      coalesce((v_group->>'required')::boolean, false),
      nullif(v_group->>'min_select', '')::int, nullif(v_group->>'max_select', '')::int,
      v_group_order,
      case when v_group->>'price_rule' = 'max' then 'max' else 'sum' end
    )
    returning id into v_group_id;
    v_group_order := v_group_order + 1;

    v_option_order := 0;
    for v_option in select * from jsonb_array_elements(coalesce(v_group->'options', '[]'::jsonb))
    loop
      if coalesce(trim(v_option->>'name'), '') = '' then continue; end if;
      v_variants := case when jsonb_typeof(v_option->'variants') = 'object' then v_option->'variants' else null end;
      insert into product_options (group_id, name, price_delta, available, "order", omie_codigo, variants)
      values (
        v_group_id, trim(v_option->>'name'), coalesce((v_option->>'price_delta')::numeric, 0),
        coalesce((v_option->>'available')::boolean, true), v_option_order,
        nullif(trim(v_option->>'omie_codigo'), ''),
        v_variants
      );
      v_option_order := v_option_order + 1;
    end loop;
  end loop;
end;
$function$;

-- create_order_secure: mesma assinatura e mesmas travas da 091 + 138 (taxa só
-- pelo caixa); só o bloco
-- de opções mudou (variação + pote 'max').
create or replace function public.create_order_secure(p_table_id uuid, p_store_id uuid, p_order_type text, p_customer_name text, p_items jsonb, p_added_by_role text default 'cliente'::text, p_added_by_name text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product products%rowtype;
  v_preco_efetivo numeric;
  v_total numeric := 0;
  v_line_total numeric;
  v_option_ids uuid[];
  v_options_delta numeric;
  v_selected_options jsonb;
  v_sel jsonb;          -- opções escolhidas, ordenadas por (grupo, opção)
  v_n int;
  v_i int;
  v_j int;
  v_e jsonb;
  v_var jsonb;
  v_d numeric[];
  v_omie text[];
  v_max_idx int;
begin
  if p_added_by_role not in ('cliente', 'garcom') then
    return jsonb_build_object('success', false, 'message', 'added_by_role inválido.');
  end if;

  -- Cardápio vitrine (091): pedido de CLIENTE recusado quando a loja
  -- desligou client_ordering.
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
    -- 138: taxa só entra pelo caixa (add_fee_item_secure).
    if v_product.fee_type is not null then
      raise exception 'Taxa só pode ser lançada pelo caixa, no fechamento da conta.';
    end if;

    v_preco_efetivo := coalesce(v_product.promo_price, v_product.price);

    select array(
      select distinct (elem)::uuid
      from jsonb_array_elements_text(coalesce(v_item->'option_ids', '[]'::jsonb)) as elem
    ) into v_option_ids;

    if coalesce(array_length(v_option_ids, 1), 0) > 30 then
      raise exception 'Número de adicionais inválido.';
    end if;

    -- Todas as opções do item de uma vez, validadas (mesmo produto + disponível).
    select coalesce(jsonb_agg(jsonb_build_object(
             'gid', pog.id, 'name', po.name, 'd', po.price_delta, 'omie', po.omie_codigo,
             'variants', po.variants, 'rule', pog.price_rule)
           order by pog."order", pog.id, po."order", po.id), '[]'::jsonb)
      into v_sel
    from product_options po
    join product_option_groups pog on pog.id = po.group_id
    where po.id = any(v_option_ids) and pog.product_id = v_product.id and po.available = true;

    v_n := jsonb_array_length(v_sel);
    if v_n <> coalesce(array_length(v_option_ids, 1), 0) then
      raise exception 'Opção inválida ou indisponível para este produto.';
    end if;

    -- a) variação: chave = nome de uma opção escolhida em OUTRO grupo do item.
    v_d := array[]::numeric[];
    v_omie := array[]::text[];
    for v_i in 0 .. v_n - 1 loop
      v_e := v_sel->v_i;
      v_d := v_d || (v_e->>'d')::numeric;
      v_omie := v_omie || (v_e->>'omie');
      if jsonb_typeof(v_e->'variants') = 'object' then
        for v_j in 0 .. v_n - 1 loop
          continue when (v_sel->v_j->>'gid') = (v_e->>'gid');
          if (v_e->'variants') ? (v_sel->v_j->>'name') then
            v_var := v_e->'variants'->(v_sel->v_j->>'name');
            if jsonb_typeof(v_var) = 'object' then
              if jsonb_typeof(v_var->'price_delta') = 'number' then
                v_d[v_i + 1] := (v_var->>'price_delta')::numeric;
              end if;
              if v_var ? 'omie_codigo' then
                v_omie[v_i + 1] := nullif(trim(v_var->>'omie_codigo'), '');
              end if;
            end if;
            exit;
          end if;
        end loop;
      end if;
      if v_d[v_i + 1] < 0 then
        raise exception 'Preço de opção inválido.';
      end if;
    end loop;

    -- b) pote 'max': só a de maior acréscimo é cobrada (empate: a primeira).
    v_max_idx := null;
    for v_i in 0 .. v_n - 1 loop
      if (v_sel->v_i->>'rule') = 'max' and (v_max_idx is null or v_d[v_i + 1] > v_d[v_max_idx + 1]) then
        v_max_idx := v_i;
      end if;
    end loop;
    if v_max_idx is not null then
      for v_i in 0 .. v_n - 1 loop
        if (v_sel->v_i->>'rule') = 'max' and v_i <> v_max_idx then
          v_d[v_i + 1] := 0;
        end if;
      end loop;
    end if;

    -- c) soma + snapshot (price_delta e omie_codigo já resolvidos).
    v_options_delta := 0;
    v_selected_options := '[]'::jsonb;
    for v_i in 0 .. v_n - 1 loop
      v_options_delta := v_options_delta + v_d[v_i + 1];
      v_selected_options := v_selected_options || jsonb_build_object(
        'name', v_sel->v_i->>'name',
        'price_delta', v_d[v_i + 1],
        'omie_codigo', v_omie[v_i + 1]
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

notify pgrst, 'reload schema';
