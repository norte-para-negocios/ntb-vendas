-- 172 — Conta aguardando pagamento (stand-by) e mesa livre para nova sessão.
-- Pedido do dono (07/10/2026): "se alguém pediu conta, a mesa fica em stand-by, porém já pode abrir outra; fica duas só
-- esperando pagamento, porém já pode ir outra pessoa para a mesa".
--
-- Desenho: a conta que vai esperar o pagamento vira uma linha própria em `tables` (standby = true, standby_de = mesa
-- física, mesmo número), com os pedidos e a sessão em aberto. A mesa física volta a 'available' com PIN novo e aceita
-- novos clientes. Como tudo no sistema já é por table_id (comanda, pagamento, close_table_orders_secure,
-- finalize_table_secure, NFC-e, Ordem de Produção, faturamento do Estoque), a conta aguardando é recebida pelo MESMO
-- fluxo de sempre, sem misturar itens com a sessão nova. Ao receber, a linha vai para 'closed' e é reaproveitada na
-- próxima vez (não cresce sem fim). Quem não usa o botão não vê nada diferente.
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d ntb_vendas < 172_mesa_conta_aguardando.sql

alter table public.tables add column if not exists standby boolean not null default false;
alter table public.tables add column if not exists standby_de uuid references public.tables(id) on delete set null;
alter table public.tables add column if not exists standby_em timestamptz;
create index if not exists idx_tables_standby_de on public.tables (standby_de) where standby;

alter table public.tables drop constraint if exists tables_status_check;
alter table public.tables add constraint tables_status_check
  check (status = any (array['available','occupied','waiting_bill','closed','blocked','standby']));

-- Leituras: a equipe vê as mesas físicas + as contas aguardando em aberto; o cliente (QR) só as mesas físicas.
create or replace function public.get_tables_secure(p_store_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.number, t.standby, t.standby_em), '[]'::jsonb)
  from tables t where t.store_id = p_store_id and (not t.standby or t.status = 'standby');
$$;

create or replace function public.get_tables_public_secure(p_store_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.number), '[]'::jsonb)
  from (
    select id, store_id, number, status, current_host_name, guest_count, waiter_requested, service_fee_removed
    from tables where store_id = p_store_id and not standby
  ) t;
$$;

-- Quantidade de mesas da loja conta só as físicas.
create or replace function public.sync_store_tables_secure(p_store_id uuid, p_target_count integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_current_count int;
  v_max_number int;
begin
  select count(*), coalesce(max(number), 0) into v_current_count, v_max_number
  from tables where store_id = p_store_id and not standby;

  if p_target_count > v_current_count then
    insert into tables (store_id, number, pin, status)
    select p_store_id, v_max_number + gs, lpad(floor(random() * 9000 + 1000)::text, 4, '0'), 'available'
    from generate_series(1, p_target_count - v_current_count) as gs;
  elsif p_target_count < v_current_count then
    delete from tables where id in (
      select id from tables where store_id = p_store_id and not standby order by number desc limit (v_current_count - p_target_count)
    );
  end if;
end;
$$;

-- Conta aguardando também é "mesa com conta em aberto" (bloqueia excluir/reduzir mesas da loja como hoje).
create or replace function public.count_active_tables_secure(p_store_id uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from tables
  where store_id = p_store_id and status in ('occupied', 'waiting_bill', 'standby');
$$;

-- Receber a conta aguardando fecha a linha (não volta a 'available').
create or replace function public.finalize_table_secure(p_table_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_new_pin text;
begin
  v_new_pin := lpad(floor(random() * 9000 + 1000)::text, 4, '0');

  update tables set
    status = case when standby then 'closed' else 'available' end,
    standby_em = case when standby then null else standby_em end,
    current_host_name = null, pin = v_new_pin,
    waiter_requested = false, service_fee_removed = false
  where id = p_table_id;

  update table_sessions set closed_at = now()
  where table_id = p_table_id and closed_at is null;

  return v_new_pin;
end;
$$;

-- Cliente nunca entra numa conta aguardando (não é listada, mas o id pode estar num link antigo).
create or replace function public.open_table_session(p_table_id uuid, p_host_name text, p_pin text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_table tables%rowtype;
  v_store stores%rowtype;
  v_pin_required boolean;
  v_is_host boolean;
begin
  select * into v_table from tables where id = p_table_id for update;
  if not found or v_table.standby then
    return jsonb_build_object('success', false, 'message', 'Mesa não encontrada.');
  end if;

  if v_table.status = 'blocked' then
    return jsonb_build_object('success', false, 'message', 'Esta mesa está bloqueada.');
  end if;

  if v_table.pin_locked_until is not null and v_table.pin_locked_until > now() then
    return jsonb_build_object('success', false, 'message', 'Muitas tentativas de PIN incorreto. Tente novamente em alguns minutos.');
  end if;

  select * into v_store from stores where id = v_table.store_id;

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
$$;

-- Liberar a mesa: a conta atual vai para "aguardando pagamento" e a mesa física fica livre (PIN novo: o cliente da
-- sessão anterior sai do cardápio pelo mesmo aviso de "mesa fechada" de sempre).
create or replace function public.liberar_mesa_secure(p_table_id uuid, p_operator_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_t tables%rowtype;
  v_s uuid;
  v_n int;
begin
  select * into v_t from tables where id = p_table_id for update;
  if not found or v_t.standby then
    return jsonb_build_object('success', false, 'message', 'Mesa não encontrada.');
  end if;
  if v_t.status not in ('occupied', 'waiting_bill') then
    return jsonb_build_object('success', false, 'message', 'A mesa não está aberta.');
  end if;
  select count(*) into v_n from orders where table_id = p_table_id and status not in ('delivered', 'canceled');
  if v_n = 0 then
    return jsonb_build_object('success', false, 'message', 'A mesa não tem conta para receber.');
  end if;

  -- reaproveita uma conta aguardando já recebida desta mesa (sem pedido em aberto)
  select t.id into v_s from tables t
   where t.standby and t.standby_de = p_table_id and t.status = 'closed'
     and not exists (select 1 from orders o where o.table_id = t.id and o.status not in ('delivered', 'canceled'))
   order by t.created_at limit 1 for update skip locked;
  if v_s is null then
    insert into tables (store_id, number, pin, status, standby, standby_de, area)
    values (v_t.store_id, v_t.number, v_t.pin, 'standby', true, p_table_id, v_t.area) returning id into v_s;
  end if;

  update tables set
    status = 'standby', number = v_t.number, pin = v_t.pin, area = v_t.area,
    current_host_name = coalesce(v_t.current_host_name, nullif(p_operator_name, '')), guest_count = v_t.guest_count,
    waiter_requested = false, service_fee_removed = v_t.service_fee_removed, standby_em = now()
  where id = v_s;

  update orders set table_id = v_s where table_id = p_table_id and status not in ('delivered', 'canceled');
  update table_sessions set table_id = v_s where table_id = p_table_id and closed_at is null;

  update tables set
    status = 'available', current_host_name = null, waiter_requested = false, guest_count = 0, service_fee_removed = false,
    pin = lpad(floor(random() * 9000 + 1000)::text, 4, '0'), pin_attempts = 0, pin_locked_until = null
  where id = p_table_id;

  return jsonb_build_object('success', true, 'standby_table_id', v_s);
end;
$$;

-- Voltar a conta aguardando para a mesa (foi sem querer): só se a mesa ainda estiver livre. Com clientes novos na mesa,
-- a conta é recebida separada — nunca se juntam duas sessões.
create or replace function public.reabrir_conta_aguardando_secure(p_standby_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s tables%rowtype;
  v_p tables%rowtype;
begin
  select * into v_s from tables where id = p_standby_id for update;
  if not found or not v_s.standby or v_s.status <> 'standby' then
    return jsonb_build_object('success', false, 'message', 'Conta não encontrada.');
  end if;
  select * into v_p from tables where id = v_s.standby_de for update;
  if not found then
    return jsonb_build_object('success', false, 'message', 'A mesa desta conta não existe mais. Receba a conta separada.');
  end if;
  if v_p.status <> 'available' then
    return jsonb_build_object('success', false, 'message', 'A mesa já tem outros clientes. Receba esta conta separada.');
  end if;

  update orders set table_id = v_p.id where table_id = v_s.id and status not in ('delivered', 'canceled');
  update table_sessions set table_id = v_p.id where table_id = v_s.id and closed_at is null;
  update tables set status = 'waiting_bill', current_host_name = v_s.current_host_name, guest_count = v_s.guest_count,
         service_fee_removed = v_s.service_fee_removed
   where id = v_p.id;
  update tables set status = 'closed', standby_em = null, current_host_name = null where id = v_s.id;
  return jsonb_build_object('success', true, 'table_id', v_p.id);
end;
$$;

grant execute on function public.liberar_mesa_secure(uuid, text) to anon, authenticated;
grant execute on function public.reabrir_conta_aguardando_secure(uuid) to anon, authenticated;

-- Nada novo entra numa conta aguardando (pedido do cliente ou do garçom vai para a mesa); só a taxa lançada pelo caixa
-- no fechamento (produto com fee_type).
create or replace function public.trg_bloquear_item_em_conta_aguardando() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from orders o join tables t on t.id = o.table_id where o.id = new.order_id and t.standby)
     and not exists (select 1 from products p where p.id = new.product_id and p.fee_type is not null) then
    raise exception 'Esta conta está aguardando pagamento. Lance o pedido na mesa.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_bloquear_item_em_conta_aguardando on public.order_items;
create trigger trg_bloquear_item_em_conta_aguardando before insert on public.order_items
  for each row execute function public.trg_bloquear_item_em_conta_aguardando();
