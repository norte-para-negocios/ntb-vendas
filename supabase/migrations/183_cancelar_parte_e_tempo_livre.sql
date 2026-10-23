-- 183: cancelar PARTE de um item e tempo livre de cancelamento (reunião 21/10/2026, André e Ramon, pedido da ODARA:
-- "pediu duas águas, quer cancelar uma: hoje tem que cancelar as duas e lançar de novo").
--
-- * cancelar_itens_v3(p_itens jsonb, ...): cada item vem com a quantidade a cancelar ({"id": ..., "qtd": 1}; sem qtd = tudo).
--   Cancelar parte divide a linha: a original fica com o que sobrou (mesmo id, então não reimprime nem perde o status da
--   cozinha) e uma linha nova, já 'canceled', guarda o que saiu (relatórios de cancelamento e o fechamento continuam
--   contando por linha cancelada). Ocorrência 'item_cancelado' grava a quantidade e o valor só do que saiu.
-- * Tempo livre: stores.config.cancel_free_minutes (0/ausente = sempre pede senha, como hoje). Com N > 0, item lançado há
--   menos de N minutos cancela sem senha, no nome de quem pediu; passado o tempo, só com a senha de quem autoriza (178/180).
-- * Os gatilhos que barram item novo (esgotado e conta aguardando) deixam passar linha que já nasce cancelada.
-- Aditiva: cancel_order_items_autorizado_secure (apps até hoje) fica igual.

create or replace function public.bloquear_item_esgotado()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_name text;
  v_sold boolean;
begin
  -- Só pedido de CLIENTE é barrado aqui. Venda do garçom/caixa (inclusive a fila offline que sincroniza depois)
  -- já foi servida e impressa: barrar na sincronização faria a venda sumir da conta. O app do garçom já avisa na tela.
  if NEW.status = 'canceled' then return NEW; end if; -- 183: parte cancelada de um item
  if NEW.product_id is null or NEW.added_by_role is distinct from 'cliente' then return NEW; end if;
  select name, sold_out into v_name, v_sold from products where id = NEW.product_id;
  if coalesce(v_sold, false) then
    raise exception 'Produto esgotado: %', v_name using errcode = 'P0001';
  end if;
  return NEW;
end;
$function$;

create or replace function public.trg_bloquear_item_em_conta_aguardando()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status = 'canceled' then return new; end if; -- 183: parte cancelada de um item
  if exists (select 1 from orders o join tables t on t.id = o.table_id where o.id = new.order_id and t.standby)
     and not exists (select 1 from products p where p.id = new.product_id and p.fee_type is not null) then
    raise exception 'Esta conta está aguardando pagamento. Lance o pedido na mesa.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

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
              it.selected_options, it.added_by_role, it.added_by_name, it.fee_manual, it.fee_manual_percent, it.priority);
      select name into v_produto from products where id = it.product_id;
      insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
      values (it.store_id, (select id from store_users where id = v_uid), coalesce(v_nome, 'Operador'), 'item_cancelado',
              jsonb_build_object('produto', coalesce(v_produto, 'Produto indisponível'),
                                 'quantidade', v_qtd, 'valor', coalesce(it.price_at_time, 0) * v_qtd,
                                 'status_anterior', it.status,
                                 'motivo', nullif(btrim(coalesce(p_reason, '')), ''),
                                 'parcial', true, 'de', it.quantity) || v_extra);
      v_cancelados := v_cancelados + 1;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'user_id', v_uid, 'name', v_nome, 'role', v_role, 'cancelados', v_cancelados,
                            'sem_senha', v_role = 'tempo_livre');
end;
$function$;
grant execute on function public.cancelar_itens_v3(jsonb, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
