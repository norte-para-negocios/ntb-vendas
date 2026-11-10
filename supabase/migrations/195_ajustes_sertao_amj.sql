-- 195: ajustes pedidos pelo Sertão/AMJ (10/11/2026).
-- 1) verify_caixa_password_secure: o lançador (garçom, modo Aberto) recebe a mesa com a SENHA DE QUEM TEM CAIXA.
--    Mesma regra de senha da 180 (senha única por loja, sem conta "Aberto", 'ambiguous', bloqueio 10 erros = 1 min por loja,
--    conta universal como último recurso). Aprova dono, conta universal ou quem tem permissions.caixa = true.
--    Devolve 'sem_permissao' (com o nome) quando a senha é de alguém sem caixa.
-- 2) add_fee_item_secure: taxa de VALOR FIXO (rolha, troca, frete, couvert) pode ser lançada por qualquer pessoa da equipe
--    da loja (o garçom lança na comanda, antes do pagamento). Taxa PERCENTUAL (taxa de serviço) continua só com caixa.
--    Limite honesto (o mesmo da 159): o operador chega como uuid; o servidor confere que é alguém da equipe desta loja
--    (não a conta "Aberto") ou conta universal, mas não autentica a sessão. O resto da função é igual à 150.

create or replace function public.verify_caixa_password_secure(p_store_id uuid, p_password text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_locked timestamptz;
  v_count int;
  v_uid uuid;
  v_nome text;
  v_role text;
  v_caixa boolean := false;
  v_attempts int;
begin
  if p_store_id is null or coalesce(p_password, '') = '' then
    return jsonb_build_object('success', false, 'error', 'invalid');
  end if;

  select locked_until into v_locked from store_open_mode_attempts where store_id = p_store_id;
  if v_locked is not null and v_locked > now() then
    return jsonb_build_object('success', false, 'error', 'locked', 'seconds', ceil(extract(epoch from v_locked - now())));
  end if;

  select count(*) into v_count from store_users
   where store_id = p_store_id and role <> 'open' and password = p_password;

  if v_count > 1 then
    return jsonb_build_object('success', false, 'error', 'ambiguous');
  elsif v_count = 1 then
    select id, name, role, (role = 'owner' or coalesce((permissions->>'caixa')::boolean, false))
      into v_uid, v_nome, v_role, v_caixa
      from store_users
     where store_id = p_store_id and role <> 'open' and password = p_password;
  else
    select id, name, 'universal', true into v_uid, v_nome, v_role, v_caixa from universal_users
     where password = p_password
     order by created_at limit 1;
  end if;

  if v_uid is null then
    if exists (select 1 from store_users where store_id = p_store_id and role = 'open' and password = p_password) then
      return jsonb_build_object('success', false, 'error', 'conta_aberta');
    end if;
    insert into store_open_mode_attempts (store_id, attempts) values (p_store_id, 1)
    on conflict (store_id) do update set attempts = store_open_mode_attempts.attempts + 1
    returning attempts into v_attempts;
    if v_attempts >= 10 then
      update store_open_mode_attempts set attempts = 0, locked_until = now() + interval '1 minute' where store_id = p_store_id;
    end if;
    return jsonb_build_object('success', false, 'error', 'invalid');
  end if;

  delete from store_open_mode_attempts where store_id = p_store_id;

  if not coalesce(v_caixa, false) then
    return jsonb_build_object('success', false, 'error', 'sem_permissao', 'name', v_nome, 'role', v_role);
  end if;

  return jsonb_build_object('success', true, 'user_id', v_uid, 'name', v_nome, 'role', v_role);
end;
$function$;
revoke all on function public.verify_caixa_password_secure(uuid, text) from public;
grant execute on function public.verify_caixa_password_secure(uuid, text) to anon, authenticated;

-- 2) add_fee_item_secure: cópia da 150 (mesma assinatura), só o bloco de permissão mudou.
create or replace function public.add_fee_item_secure(
  p_store_id uuid,
  p_table_id uuid,
  p_product_id uuid,
  p_quantity int default 1,
  p_operator_user_id uuid default null,
  p_operator_name text default null,
  p_amount numeric default null,
  p_percent numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_product products%rowtype;
  v_pode boolean;
  v_role text;
  v_equipe boolean;
  v_base numeric;
  v_price numeric;
  v_qty int;
  v_manual boolean := false;
  v_manual_pct numeric := null;
  v_exist_id uuid;
  v_exist_order uuid;
  v_exist_price numeric;
  v_exist_manual boolean;
  v_exist_manual_pct numeric;
  v_order_id uuid;
  v_item_id uuid;
begin
  select * into v_product from products where id = p_product_id and store_id = p_store_id;
  if not found or v_product.fee_type is null then
    return jsonb_build_object('success', false, 'message', 'Taxa inválida para esta loja.');
  end if;
  -- Trava a mesa: dois toques seguidos não duplicam o item.
  perform 1 from tables t where t.id = p_table_id and t.store_id = p_store_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Mesa inválida para esta loja.');
  end if;

  -- 195: taxa FIXA = qualquer pessoa da equipe desta loja (não a conta "Aberto") ou conta universal;
  -- taxa PERCENTUAL = só caixa (dono, permissions.caixa ou conta universal; regra de lib/taxas.ts podeLancarTaxa).
  if p_operator_user_id is null then
    return jsonb_build_object('success', false, 'message',
      case when v_product.fee_type = 'fixed' then 'Diga quem está lançando a taxa.' else 'Só quem tem permissão de caixa pode lançar taxa.' end);
  end if;
  select su.role, (su.role = 'owner' or coalesce((su.permissions->>'caixa')::boolean, false))
    into v_role, v_pode
    from store_users su where su.id = p_operator_user_id and su.store_id = p_store_id;
  if v_role is null then
    v_pode := exists (select 1 from universal_users u where u.id = p_operator_user_id);
    v_equipe := v_pode;
  else
    v_equipe := v_role <> 'open';
  end if;
  if v_product.fee_type = 'fixed' then
    if not coalesce(v_equipe, false) then
      return jsonb_build_object('success', false, 'message', 'Só alguém da equipe da loja pode lançar taxa.');
    end if;
  elsif not coalesce(v_pode, false) then
    return jsonb_build_object('success', false, 'message', 'Só quem tem permissão de caixa pode lançar taxa.');
  end if;

  if not exists (select 1 from orders o where o.table_id = p_table_id and o.store_id = p_store_id
                   and o.status not in ('delivered', 'canceled')) then
    return jsonb_build_object('success', false, 'message', 'Mesa sem conta aberta.');
  end if;

  if p_amount is not null and p_percent is not null then
    return jsonb_build_object('success', false, 'message', 'Informe o valor OU o percentual, não os dois.');
  end if;
  if p_amount is not null and p_amount < 0 then
    return jsonb_build_object('success', false, 'message', 'Valor da taxa não pode ser negativo.');
  end if;
  if p_percent is not null and (p_percent < 0 or p_percent > 100) then
    return jsonb_build_object('success', false, 'message', 'Percentual da taxa deve ficar entre 0 e 100.');
  end if;

  if v_product.fee_type = 'percent' then
    select coalesce(sum(oi.price_at_time * oi.quantity), 0) into v_base
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = oi.product_id
     where o.table_id = p_table_id and o.store_id = p_store_id
       and o.status not in ('delivered', 'canceled')
       and oi.status <> 'canceled'
       and p.fee_type is null;
    v_base := round(v_base, 2);
    v_qty := 1;

    select oi.id, oi.order_id, oi.price_at_time, oi.fee_manual, oi.fee_manual_percent
      into v_exist_id, v_exist_order, v_exist_price, v_exist_manual, v_exist_manual_pct
      from order_items oi
      join orders o on o.id = oi.order_id
     where o.table_id = p_table_id and o.store_id = p_store_id
       and o.status not in ('delivered', 'canceled')
       and oi.status <> 'canceled'
       and oi.product_id = p_product_id
     limit 1;

    if p_amount is not null then
      v_manual := true;
      v_price := round(p_amount, 2);
      if v_price > v_base then
        return jsonb_build_object('success', false, 'message', 'A taxa não pode ser maior que o total da conta (R$ ' || replace(to_char(v_base, 'FM999999990.00'), '.', ',') || ').');
      end if;
    elsif p_percent is not null then
      v_manual := true;
      v_manual_pct := p_percent;
      v_price := round(v_base * p_percent / 100, 2);
    elsif coalesce(v_exist_manual, false) then
      -- Recálculo sem valor novo sobre item já editado: percentual editado recalcula com ELE;
      -- valor digitado em R$ fica como está.
      v_manual := true;
      if v_exist_manual_pct is null then
        return jsonb_build_object('success', true, 'item_id', v_exist_id, 'price', v_exist_price, 'updated', false);
      end if;
      v_manual_pct := v_exist_manual_pct;
      v_price := round(v_base * v_manual_pct / 100, 2);
    else
      v_price := round(v_base * v_product.fee_percent / 100, 2);
    end if;

    if v_manual and v_price = 0 then
      -- Taxa zerada = sem taxa de serviço (igual "Tirar a taxa"): tira o item e marca a mesa.
      if v_exist_id is not null then
        delete from order_items where id = v_exist_id;
        update orders set total = greatest(total - v_exist_price, 0), updated_at = now() where id = v_exist_order;
        if not exists (select 1 from order_items where order_id = v_exist_order) then
          delete from orders where id = v_exist_order;
        end if;
      end if;
      update tables set service_fee_removed = true where id = p_table_id;
      insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
      values (p_store_id, (select id from store_users where id = p_operator_user_id), coalesce(p_operator_name, 'Operador'), 'taxa_removida',
              jsonb_build_object('produto', v_product.name, 'valor', coalesce(v_exist_price, 0)));
      return jsonb_build_object('success', true, 'item_id', null, 'price', 0, 'updated', v_exist_id is not null, 'removed', true);
    end if;
    if v_price <= 0 then
      return jsonb_build_object('success', false, 'message', 'A conta não tem itens pra calcular a taxa.');
    end if;

    if v_exist_id is not null then
      update order_items set price_at_time = v_price, fee_manual = v_manual, fee_manual_percent = v_manual_pct
       where id = v_exist_id;
      update orders set total = total - v_exist_price + v_price, updated_at = now() where id = v_exist_order;
      update tables set service_fee_removed = true where id = p_table_id;
      if v_manual then
        insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
        values (p_store_id, (select id from store_users where id = p_operator_user_id), coalesce(p_operator_name, 'Operador'), 'taxa_editada',
                jsonb_build_object('produto', v_product.name, 'de', v_exist_price, 'para', v_price, 'valor', abs(v_exist_price - v_price)));
      end if;
      return jsonb_build_object('success', true, 'item_id', v_exist_id, 'price', v_price, 'updated', true);
    end if;
  else
    if p_percent is not null then
      return jsonb_build_object('success', false, 'message', 'Esta taxa é de valor fixo: informe o valor em R$.');
    end if;
    v_qty := coalesce(p_quantity, 1);
    if v_qty < 1 or v_qty > 99 then
      return jsonb_build_object('success', false, 'message', 'Quantidade inválida.');
    end if;
    if p_amount is not null then
      if p_amount <= 0 or p_amount > 5000 then
        return jsonb_build_object('success', false, 'message', 'Valor da taxa deve ficar entre R$ 0,01 e R$ 5.000,00.');
      end if;
      v_manual := true;
      v_price := round(p_amount, 2);
    else
      v_price := coalesce(v_product.promo_price, v_product.price);
    end if;
  end if;

  -- Reaproveita o pedido de taxas aberto da mesa (só tem item-taxa), senão cria.
  select o.id into v_order_id
    from orders o
   where o.table_id = p_table_id and o.store_id = p_store_id and o.status = 'accepted'
     and exists (select 1 from order_items oi where oi.order_id = o.id)
     and not exists (
       select 1 from order_items oi left join products p on p.id = oi.product_id
        where oi.order_id = o.id and p.fee_type is null)
   limit 1;
  if v_order_id is null then
    insert into orders (table_id, store_id, status, order_type, total, customer_name)
    values (p_table_id, p_store_id, 'accepted', 'table', 0, null)
    returning id into v_order_id;
  end if;

  insert into order_items (order_id, product_id, quantity, status, notes, price_at_time, selected_options, added_by_role, added_by_name, fee_manual, fee_manual_percent)
  values (v_order_id, p_product_id, v_qty, 'delivered', null, v_price, '[]'::jsonb, 'garcom', p_operator_name, v_manual, v_manual_pct)
  returning id into v_item_id;

  update orders set total = total + v_price * v_qty, updated_at = now() where id = v_order_id;

  if v_product.fee_type = 'percent' then
    update tables set service_fee_removed = true where id = p_table_id;
  end if;

  if v_manual then
    insert into cash_shift_audit_events (store_id, operator_user_id, operator_name, event_type, details)
    values (p_store_id, (select id from store_users where id = p_operator_user_id), coalesce(p_operator_name, 'Operador'), 'taxa_editada',
            jsonb_build_object('produto', v_product.name, 'de', coalesce(v_product.promo_price, v_product.price), 'para', v_price, 'valor', abs(coalesce(v_product.promo_price, v_product.price) - v_price)));
  end if;

  return jsonb_build_object('success', true, 'item_id', v_item_id, 'price', v_price, 'updated', false);
exception when others then
  return jsonb_build_object('success', false, 'message', SQLERRM);
end;
$$;
grant execute on function public.add_fee_item_secure(uuid, uuid, uuid, int, uuid, text, numeric, numeric) to anon, authenticated;

notify pgrst, 'reload schema';
