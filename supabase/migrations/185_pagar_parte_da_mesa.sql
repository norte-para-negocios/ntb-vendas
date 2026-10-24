-- 185: pagar só a parte de uma pessoa e a mesa continuar (pedido da ODARA, 24/10/2026: "uma pessoa vai embora e quer
-- pagar só a parte dela; hoje só dá para pagar tudo").
--
-- separar_parte_da_conta_secure(p_store_id, p_table_id, p_itens jsonb [{id, qtd}], p_nome, ...): os itens escolhidos
-- viram uma CONTA AGUARDANDO da mesma mesa (mesmo mecanismo do "Liberar a mesa", 171), que o caixa recebe e fecha pelo
-- caminho normal (nota fiscal, caixa, comprovante). A mesa original continua aberta com o resto.
-- Parte de uma linha (4 cervejas, paga 1): a linha ORIGINAL (mesmo id, mesmo histórico de impressão) vai para a conta
-- separada com a quantidade paga e uma linha nova fica na mesa com o resto. Assim nada é inserido na conta aguardando
-- (o gatilho de conta aguardando barra INSERT) e a cozinha não recebe nada de novo.

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
  if current_setting('ntb.dividindo_item', true) = '1' then return NEW; end if; -- 185: resto de um item já vendido
  if NEW.product_id is null or NEW.added_by_role is distinct from 'cliente' then return NEW; end if;
  select name, sold_out into v_name, v_sold from products where id = NEW.product_id;
  if coalesce(v_sold, false) then
    raise exception 'Produto esgotado: %', v_name using errcode = 'P0001';
  end if;
  return NEW;
end;
$function$;

create or replace function public.separar_parte_da_conta_secure(
  p_store_id uuid,
  p_table_id uuid,
  p_itens jsonb,
  p_nome text default null,
  p_operator_user_id uuid default null,
  p_operator_name text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_t tables%rowtype;
  v_s uuid;
  v_order uuid;
  v_el jsonb;
  v_qtd int;
  it record;
  v_nome text := coalesce(nullif(btrim(coalesce(p_nome, '')), ''), 'Parte da mesa');
  v_valor numeric := 0;
  v_n int := 0;
  v_src uuid[] := '{}';
begin
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 or jsonb_array_length(p_itens) > 200 then
    return jsonb_build_object('success', false, 'message', 'Escolha os itens da parte que vai pagar.');
  end if;
  if p_operator_user_id is not null and not exists (
       select 1 from store_users su where su.id = p_operator_user_id and su.store_id = p_store_id)
     and not exists (select 1 from universal_users u where u.id = p_operator_user_id) then
    return jsonb_build_object('success', false, 'message', 'Operador inválido.');
  end if;
  select * into v_t from tables where id = p_table_id and store_id = p_store_id for update;
  if not found or v_t.standby then return jsonb_build_object('success', false, 'message', 'Mesa não encontrada.'); end if;
  if v_t.status not in ('occupied', 'waiting_bill') then
    return jsonb_build_object('success', false, 'message', 'A mesa não está aberta.');
  end if;

  -- Conta aguardando nova (ou uma já recebida desta mesa, como o 171 faz).
  select t.id into v_s from tables t
   where t.standby and t.standby_de = p_table_id and t.status = 'closed'
     and not exists (select 1 from orders o where o.table_id = t.id and o.status not in ('delivered', 'canceled'))
   order by t.created_at limit 1 for update skip locked;
  if v_s is null then
    insert into tables (store_id, number, pin, status, standby, standby_de, area)
    values (v_t.store_id, v_t.number, v_t.pin, 'standby', true, p_table_id, v_t.area) returning id into v_s;
  end if;
  update tables set
    status = 'standby', number = v_t.number, pin = v_t.pin, area = v_t.area, current_host_name = v_nome, guest_count = 1,
    waiter_requested = false, service_fee_removed = v_t.service_fee_removed, standby_em = now()
  where id = v_s;
  insert into orders (table_id, store_id, status, order_type, total, customer_name)
  values (v_s, p_store_id, 'pending', 'table', 0, v_nome) returning id into v_order;
  insert into table_sessions (table_id, store_id, host_name) values (v_s, p_store_id, v_nome);

  perform set_config('ntb.dividindo_item', '1', true);
  for v_el in select * from jsonb_array_elements(p_itens) loop
    select oi.*, p.fee_type, o.table_id as src_table into it
      from order_items oi join orders o on o.id = oi.order_id left join products p on p.id = oi.product_id
     where oi.id = (v_el->>'id')::uuid and o.store_id = p_store_id and o.table_id = p_table_id
       and o.status not in ('delivered', 'canceled')
     for update of oi;
    if not found or it.status = 'canceled' or it.fee_type is not null or it.fiscal_nota_id is not null then continue; end if;
    v_qtd := case when coalesce(v_el->>'qtd', '') ~ '^\d+$' then least((v_el->>'qtd')::int, it.quantity) else it.quantity end;
    if v_qtd <= 0 then continue; end if;

    if v_qtd < it.quantity then
      -- O resto fica na mesa numa linha nova; a original vai para a conta separada.
      insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, created_at, store_id,
                               selected_options, added_by_role, added_by_name, fee_manual, fee_manual_percent, priority)
      values (it.order_id, it.product_id, it.quantity - v_qtd, it.status, it.notes, it.price_at_time, it.created_at, it.store_id,
              it.selected_options, it.added_by_role, it.added_by_name, it.fee_manual, it.fee_manual_percent, it.priority);
    end if;
    update order_items set order_id = v_order, quantity = v_qtd where id = it.id;
    update orders set total = greatest(total - it.price_at_time * v_qtd, 0), updated_at = now() where id = it.order_id;
    update orders set total = total + it.price_at_time * v_qtd, updated_at = now() where id = v_order;
    v_src := v_src || it.order_id;
    v_valor := v_valor + it.price_at_time * v_qtd;
    v_n := v_n + 1;
  end loop;
  perform set_config('ntb.dividindo_item', '0', true);

  if v_n = 0 then
    -- Nada separado: desfaz a conta aguardando criada agora.
    delete from table_sessions where table_id = v_s and closed_at is null;
    delete from orders where id = v_order;
    update tables set status = 'closed' where id = v_s;
    return jsonb_build_object('success', false, 'message', 'Nenhum item pôde ser separado (cancelado, taxa ou já com nota).');
  end if;
  delete from orders o where o.id = any(v_src) and not exists (select 1 from order_items i where i.order_id = o.id);

  -- Registro: o app grava 'conta.separada' na auditoria (staff_audit_log), como o mover item; as linhas movidas
  -- também ficam no gatilho de auditoria de order_items.

  return jsonb_build_object('success', true, 'standby_table_id', v_s, 'itens', v_n, 'valor', v_valor);
end;
$function$;
grant execute on function public.separar_parte_da_conta_secure(uuid, uuid, jsonb, text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
