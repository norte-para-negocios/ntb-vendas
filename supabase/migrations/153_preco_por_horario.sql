-- 153: preço por horário / happy hour (2026-10-04, plano próximas features, item 5).
-- Regra: "produto ou categoria X custa R$ Y (ou -Z%) em certos dias e horários". O servidor cobra o preço vigente
-- (create_order_secure chama effective_product_price); o app mostra o mesmo preço via lib/priceSchedule.ts
-- (paridade testada). Escrita só por RPC (tabela com select público e nenhuma policy de escrita).
create table if not exists price_schedules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  product_id uuid references products(id) on delete cascade,
  category_id uuid references categories(id) on delete cascade,
  price numeric(10,2) check (price is null or price >= 0),
  discount_percent numeric(5,2) check (discount_percent is null or (discount_percent > 0 and discount_percent <= 100)),
  days int[],                       -- 0=domingo..6=sábado; null = todos os dias
  time_from time not null,
  time_until time not null,         -- janela que vira a meia-noite (ex.: 22:00-02:00) é aceita
  timezone text not null default 'America/Bahia',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((product_id is not null) <> (category_id is not null)),
  check ((price is not null) <> (discount_percent is not null))
);
create index if not exists idx_price_schedules_store on price_schedules(store_id, active);
alter table price_schedules enable row level security;
drop policy if exists price_schedules_select on price_schedules;
create policy price_schedules_select on price_schedules for select using (true);

-- Preço vigente do produto agora: o menor entre o preço-base e as regras que casam com o dia/horário.
create or replace function public.effective_product_price(p_product_id uuid, p_store_id uuid, p_category_id uuid, p_base numeric, p_at timestamptz)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_best numeric := p_base;
  r record;
  v_local timestamp;
  v_t time;
  v_dow int;
  v_candidate numeric;
  v_ok boolean;
begin
  for r in
    select * from price_schedules
     where store_id = p_store_id and active
       and (product_id = p_product_id or (category_id is not null and category_id = p_category_id))
  loop
    v_local := p_at at time zone r.timezone;
    v_t := v_local::time;
    v_dow := extract(dow from v_local)::int;
    if r.time_from <= r.time_until then
      v_ok := v_t >= r.time_from and v_t < r.time_until
              and (r.days is null or v_dow = any(r.days));
    else
      -- vira a meia-noite: depois da meia-noite vale o dia anterior
      v_ok := (v_t >= r.time_from and (r.days is null or v_dow = any(r.days)))
           or (v_t < r.time_until and (r.days is null or ((v_dow + 6) % 7) = any(r.days)));
    end if;
    if v_ok then
      v_candidate := case when r.price is not null then r.price else round(p_base * (100 - r.discount_percent) / 100, 2) end;
      if v_candidate < v_best then v_best := v_candidate; end if;
    end if;
  end loop;
  return v_best;
end;
$$;
grant execute on function public.effective_product_price(uuid, uuid, uuid, numeric, timestamptz) to anon, authenticated;

create or replace function public.save_price_schedule_secure(p_store_id uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- A regra só pode apontar pra produto/categoria da própria loja e cada loja tem até 200 regras
  -- (create_order_secure percorre as regras a cada item).
  if nullif(p_data->>'product_id', '') is not null and not exists (select 1 from products where id = (p_data->>'product_id')::uuid and store_id = p_store_id) then
    raise exception 'Produto inválido para esta loja.';
  end if;
  if nullif(p_data->>'category_id', '') is not null and not exists (select 1 from categories where id = (p_data->>'category_id')::uuid and store_id = p_store_id) then
    raise exception 'Categoria inválida para esta loja.';
  end if;
  if p_id is null and (select count(*) from price_schedules where store_id = p_store_id) >= 200 then
    raise exception 'Limite de 200 regras de preço por loja.';
  end if;
  if p_id is null then
    insert into price_schedules (store_id, name, product_id, category_id, price, discount_percent, days, time_from, time_until, active)
    values (p_store_id, left(p_data->>'name', 80), nullif(p_data->>'product_id', '')::uuid, nullif(p_data->>'category_id', '')::uuid,
            nullif(p_data->>'price', '')::numeric, nullif(p_data->>'discount_percent', '')::numeric,
            case when jsonb_typeof(p_data->'days') = 'array' and jsonb_array_length(p_data->'days') > 0
                 then array(select jsonb_array_elements_text(p_data->'days')::int) else null end,
            (p_data->>'time_from')::time, (p_data->>'time_until')::time, coalesce((p_data->>'active')::boolean, true))
    returning id into v_id;
  else
    update price_schedules set
      name = left(p_data->>'name', 80),
      product_id = nullif(p_data->>'product_id', '')::uuid, category_id = nullif(p_data->>'category_id', '')::uuid,
      price = nullif(p_data->>'price', '')::numeric, discount_percent = nullif(p_data->>'discount_percent', '')::numeric,
      days = case when jsonb_typeof(p_data->'days') = 'array' and jsonb_array_length(p_data->'days') > 0
                  then array(select jsonb_array_elements_text(p_data->'days')::int) else null end,
      time_from = (p_data->>'time_from')::time, time_until = (p_data->>'time_until')::time,
      active = coalesce((p_data->>'active')::boolean, true)
    where id = p_id and store_id = p_store_id returning id into v_id;
  end if;
  return v_id;
end;
$$;
grant execute on function public.save_price_schedule_secure(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.delete_price_schedule_secure(p_store_id uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from price_schedules where id = p_id and store_id = p_store_id;
  return found;
end;
$$;
grant execute on function public.delete_price_schedule_secure(uuid, uuid) to anon, authenticated;

-- create_order_secure: igual à versão em produção (140), trocando só o preço efetivo.
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
    -- Mesa livre que recebe pedido do GARÇOM volta a ficar ocupada (incidente 02/10, mesas 108 e 216: sessão fechada
    -- e itens lançados depois, mesa "sumia"). Só garçom: cliente do QR continua entrando pelo PIN. Sem lock prévio.
    if p_added_by_role = 'garcom' then
      update tables set status = 'occupied', current_host_name = coalesce(current_host_name, nullif(p_added_by_name, ''))
       where id = p_table_id and status = 'available';
      if found and not exists (select 1 from table_sessions where table_id = p_table_id and closed_at is null) then
        insert into table_sessions (table_id, store_id, host_name) values (p_table_id, p_store_id, nullif(p_added_by_name, ''));
      end if;
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

    v_preco_efetivo := public.effective_product_price(v_product.id, v_product.store_id, v_product.category_id, coalesce(v_product.promo_price, v_product.price), now());

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
