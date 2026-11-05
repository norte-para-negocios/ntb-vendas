-- 193: relatório de cancelamentos detalhado + cancelar venda de balcão (04/11/2026, pedido do dono).
-- 1) Cada ocorrência 'item_cancelado' passa a guardar QUAL item foi (item_id/order_id), onde estava (mesa ou balcão,
--    cliente), quando foi pedido e por quem foi lançado. Antes só tinha produto, valor, motivo e quem autorizou.
-- 2) cancelar_itens_v3: venda de balcão não paga que fica sem itens vira pedido cancelado (antes ficava presa na tela).
-- 3) fetch_cancelamentos_secure: lista cada cancelamento com hora do pedido, hora do cancelamento, local, setor de
--    preparo, quem pediu, quem cancelou, quem autorizou e o motivo. Ocorrências antigas (sem item_id) aparecem com o
--    que foi gravado na época.
-- Aplicar: docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < 193_cancelamentos_detalhados.sql

create or replace function public._contexto_item_cancelado(p_item_id uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
      'item_id', oi.id, 'order_id', o.id, 'tipo', o.order_type,
      'mesa', (select tb.number from tables tb where tb.id = o.table_id),
      'cliente', nullif(btrim(coalesce(o.customer_name, '')), ''),
      'pedido_em', oi.created_at,
      'lancado_por', nullif(btrim(coalesce(oi.added_by_name, '')), ''),
      'lancado_papel', oi.added_by_role))
    from order_items oi join orders o on o.id = oi.order_id where oi.id = p_item_id), '{}'::jsonb);
$$;
revoke all on function public._contexto_item_cancelado(uuid) from public, anon, authenticated;

create or replace function public._cancelar_item_registrado(p_item_id uuid, p_operator_user_id uuid, p_operator_name text, p_reason text, p_extra jsonb default '{}'::jsonb)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
                               'motivo', nullif(btrim(coalesce(p_reason, '')), '')) || _contexto_item_cancelado(p_item_id) || coalesce(p_extra, '{}'::jsonb));
  end if;
  return v_store_id is not null;
end;
$function$;
revoke all on function public._cancelar_item_registrado(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public.cancelar_itens_v3(
  p_itens jsonb,
  p_password text,
  p_reason text,
  p_action text default 'cancelar_item',
  p_solicitado_por text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ids uuid[];
  v_lojas uuid[];
  v_store uuid;
  v_min int;
  v_livre boolean := false;
  v_locked timestamptz;
  v_count int;
  v_uid uuid;
  v_nome text;
  v_role text;
  v_attempts int;
  v_extra jsonb;
  v_el jsonb;
  v_qtd int;
  it order_items%rowtype;
  v_produto text;
  v_cancelados int := 0;
  v_novo uuid;
begin
  if p_action not in ('cancelar_item', 'cancelar_pedido') then p_action := 'cancelar_item'; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 or jsonb_array_length(p_itens) > 200 then
    return jsonb_build_object('success', false, 'error', 'itens');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('success', false, 'error', 'motivo');
  end if;

  select array_agg((e->>'id')::uuid) into v_ids from jsonb_array_elements(p_itens) e;
  select array_agg(distinct store_id) into v_lojas from order_items where id = any(v_ids);
  if coalesce(array_length(v_lojas, 1), 0) <> 1 then
    return jsonb_build_object('success', false, 'error', 'itens');
  end if;
  v_store := v_lojas[1];

  if exists (select 1 from order_items where id = any(v_ids) and fiscal_nota_id is not null and status <> 'canceled') then
    return jsonb_build_object('success', false, 'error', 'faturado');
  end if;

  -- Tempo livre: todos os itens lançados há menos de N minutos.
  select case when coalesce(config->>'cancel_free_minutes', '') ~ '^\d+$' then (config->>'cancel_free_minutes')::int else 0 end
    into v_min from stores where id = v_store;
  if v_min > 0 then
    v_livre := not exists (select 1 from order_items where id = any(v_ids) and status <> 'canceled'
                                                       and created_at < now() - make_interval(mins => v_min));
  end if;

  if coalesce(p_password, '') = '' then
    if not v_livre then
      return jsonb_build_object('success', false, 'error', 'precisa_senha', 'minutos', v_min);
    end if;
    v_nome := coalesce(nullif(btrim(coalesce(p_solicitado_por, '')), ''), 'Equipe');
    v_role := 'tempo_livre';
  else
    select locked_until into v_locked from store_open_mode_attempts where store_id = v_store;
    if v_locked is not null and v_locked > now() then
      return jsonb_build_object('success', false, 'error', 'locked', 'seconds', ceil(extract(epoch from v_locked - now())));
    end if;

    -- Quem é o dono da senha (mesma regra de 180); senão, a conta universal.
    select count(*) into v_count from store_users
     where store_id = v_store and role <> 'open' and password = p_password;
    if v_count > 1 then
      return jsonb_build_object('success', false, 'error', 'ambiguous');
    elsif v_count = 1 then
      select id, name, role into v_uid, v_nome, v_role from store_users
       where store_id = v_store and role <> 'open' and password = p_password;
    else
      select id, name, 'universal' into v_uid, v_nome, v_role from universal_users
       where password = p_password
       order by created_at limit 1;
    end if;

    if v_uid is null then
      insert into store_open_mode_attempts (store_id, attempts) values (v_store, 1)
      on conflict (store_id) do update set attempts = store_open_mode_attempts.attempts + 1
      returning attempts into v_attempts;
      if v_attempts >= 10 then
        update store_open_mode_attempts set attempts = 0, locked_until = now() + interval '1 minute' where store_id = v_store;
      end if;
      return jsonb_build_object('success', false, 'error', 'invalid');
    end if;
    delete from store_open_mode_attempts where store_id = v_store;

    if not operator_can_secure(v_store, v_uid, p_action) then
      return jsonb_build_object('success', false, 'error', 'sem_permissao', 'name', v_nome, 'role', v_role);
    end if;
  end if;

  v_extra := case when v_role = 'tempo_livre'
                  then jsonb_build_object('sem_senha', true, 'tempo_livre_min', v_min)
                  else jsonb_build_object('autorizado_por', v_nome) end
          || case when v_role <> 'tempo_livre' and nullif(btrim(coalesce(p_solicitado_por, '')), '') is not null and btrim(p_solicitado_por) <> v_nome
                  then jsonb_build_object('solicitado_por', btrim(p_solicitado_por)) else '{}'::jsonb end;

  for v_el in select * from jsonb_array_elements(p_itens) loop
    select * into it from order_items where id = (v_el->>'id')::uuid for update;
    if not found or it.status = 'canceled' then continue; end if;
    v_qtd := case when coalesce(v_el->>'qtd', '') ~ '^\d+$' then (v_el->>'qtd')::int else it.quantity end;
    if v_qtd <= 0 then continue; end if;

    if v_qtd >= it.quantity then
      if _cancelar_item_registrado(it.id, case when v_role in ('universal', 'tempo_livre') then null else v_uid end, v_nome, btrim(p_reason), v_extra) then
        v_cancelados := v_cancelados + 1;
      end if;
    else
      -- Parte: a linha original fica com o que sobrou; a parte que saiu vira uma linha cancelada.
      update order_items set quantity = it.quantity - v_qtd where id = it.id;
      insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, created_at, store_id,
                               selected_options, added_by_role, added_by_name, fee_manual, fee_manual_percent, priority)
      values (it.order_id, it.product_id, v_qtd, 'canceled', it.notes, it.price_at_time, it.created_at, it.store_id,
              it.selected_options, it.added_by_role, it.added_by_name, it.fee_manual, it.fee_manual_percent, it.priority)
      returning id into v_novo;
      select name into v_produto from products where id = it.product_id;
      insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
      values (it.store_id, (select id from store_users where id = v_uid), coalesce(v_nome, 'Operador'), 'item_cancelado',
              jsonb_build_object('produto', coalesce(v_produto, 'Produto indisponível'),
                                 'quantidade', v_qtd, 'valor', coalesce(it.price_at_time, 0) * v_qtd,
                                 'status_anterior', it.status,
                                 'motivo', nullif(btrim(coalesce(p_reason, '')), ''),
                                 'parcial', true, 'de', it.quantity) || _contexto_item_cancelado(v_novo) || v_extra);
      v_cancelados := v_cancelados + 1;
    end if;
  end loop;

  -- 193: venda de BALCÃO não paga que ficou sem nenhum item vira pedido cancelado (some do Balcão/Caixa e vai para
  -- Vendas > Canceladas). Pedido pago não: o pagamento precisa ser estornado antes (a tela já pede isso).
  update orders o set status = 'canceled', updated_at = now()
   where o.id in (select distinct order_id from order_items where id = any(v_ids))
     and o.order_type = 'counter' and o.status <> 'canceled' and o.payment_details is null
     and not exists (select 1 from order_items x where x.order_id = o.id and x.status <> 'canceled');

  return jsonb_build_object('success', true, 'user_id', v_uid, 'name', v_nome, 'role', v_role, 'cancelados', v_cancelados,
                            'sem_senha', v_role = 'tempo_livre');
end;
$function$;
grant execute on function public.cancelar_itens_v3(jsonb, text, text, text, text) to anon, authenticated;

create or replace function public.fetch_cancelamentos_secure(
  p_store_id uuid, p_inicio timestamptz default null, p_fim timestamptz default null, p_token text default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not _sessao_equipe_ok(p_token, p_store_id, false) then raise exception 'sessao'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.cancelado_em desc) from (
      select e.id, e.created_at as cancelado_em,
        coalesce(e.details->>'produto', p.name, 'Produto') as produto,
        coalesce((e.details->>'quantidade')::numeric, oi.quantity) as quantidade,
        coalesce((e.details->>'valor')::numeric, 0) as valor,
        e.details->>'motivo' as motivo,
        coalesce(e.details->>'autorizado_por', case when (e.details->>'sem_senha')::boolean then null else e.operator_name end) as autorizado_por,
        coalesce(e.details->>'solicitado_por', e.operator_name) as cancelado_por,
        coalesce((e.details->>'sem_senha')::boolean, false) as sem_senha,
        coalesce((e.details->>'parcial')::boolean, false) as parcial,
        e.details->>'status_anterior' as status_anterior,
        coalesce(e.details->>'tipo', o.order_type) as tipo,
        coalesce((e.details->>'mesa')::int, (select tb.number from tables tb where tb.id = o.table_id)) as mesa,
        coalesce(e.details->>'cliente', nullif(btrim(coalesce(o.customer_name, '')), '')) as cliente,
        coalesce((e.details->>'pedido_em')::timestamptz, oi.created_at) as pedido_em,
        coalesce(e.details->>'lancado_por', oi.added_by_name) as lancado_por,
        coalesce(e.details->>'lancado_papel', oi.added_by_role) as lancado_papel,
        coalesce(ps.name, case coalesce(p.destination, '') when 'bar' then 'Bar' when 'kitchen' then 'Cozinha' else null end) as setor
      from cash_shift_audit_events e
      left join order_items oi on oi.id = case when coalesce(e.details->>'item_id', '') ~ '^[0-9a-f-]{36}$' then (e.details->>'item_id')::uuid end
      left join orders o on o.id = oi.order_id
      left join products p on p.id = oi.product_id
      left join categories c on c.id = p.category_id
      left join print_sectors ps on ps.id = coalesce(p.sector_id, c.sector_id)
      where e.store_id = p_store_id and e.event_type = 'item_cancelado'
        and (p_inicio is null or e.created_at >= p_inicio)
        and (p_fim is null or e.created_at < p_fim)
      order by e.created_at desc
      limit 2000
    ) t), '[]'::jsonb);
end $$;
grant execute on function public.fetch_cancelamentos_secure(uuid, timestamptz, timestamptz, text) to anon, authenticated;

notify pgrst, 'reload schema';
