-- 178: cancelar item/pedido com a senha de quem autoriza (19/10/2026, pedido do dono: "o caixa não tá conseguindo cancelar um
-- produto ... se a pessoa vai cancelar, tem que pedir uma senha; se a senha for de gerente ou caixa, ou de quem tiver permissão,
-- consegue cancelar"). E "dar acesso a outra loja" sem tirar da loja atual (no mesmo dia a Tai foi MOVIDA do Sertão para a ODARA
-- pelo "Vincular à Loja" do Master Admin, quando devia ficar nas duas).
--
-- * Caixa cancela item e pedido por padrão (antes só gerente, ou quem tinha "trocas"). A matriz Equipe > Permissões continua
--   valendo: valor salvo para a função vence o padrão.
-- * cancel_order_items_autorizado_secure: a senha identifica quem autoriza (senha única por loja, 158; conta universal também
--   vale). Pode quem tem a permissão da ação (operator_can_secure). O cancelamento fica no nome de quem autorizou e grava
--   quem pediu. Mesmo limite de erros da senha do pedido (10 erros = 1 min por loja, store_open_mode_attempts).
-- * copy_store_user_to_store_secure: cria na outra loja um login igual (nome, e-mail, senha, função, permissões). Com a mesma
--   senha nas duas, o login mostra "Qual loja você quer acessar?" (177).
-- Aditiva: v2 e a função antiga seguem iguais (só o padrão do caixa mudou).

create or replace function public.operator_can_secure(p_store_id uuid, p_user_id uuid, p_action text)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  u store_users%rowtype;
  v jsonb;
begin
  if p_user_id is null or p_store_id is null then return false; end if;
  if exists (select 1 from universal_users x where x.id = p_user_id) then return true; end if;
  select * into u from store_users where id = p_user_id and store_id = p_store_id;
  if not found then return false; end if;
  if u.role = 'owner' then return true; end if;
  if u.role = 'open' then return false; end if;
  -- permissões individuais que já existiam (mesmo mapa de lib/rolePermissions.ts)
  if coalesce(u.permissions->>'trocas', 'false') = 'true' and p_action in ('cancelar_item', 'trocar_mesa', 'mover_item', 'cancelar_pedido') then return true; end if;
  if coalesce(u.permissions->>'supervisiona_caixa', 'false') = 'true' and p_action in ('cancelar_pedido', 'ver_excecoes') then return true; end if;
  -- matriz da loja (Equipe > Permissões); sem valor salvo: gerente pode tudo, caixa cancela item e pedido (178)
  select s.config->'role_permissions'->u.role->p_action into v from stores s where s.id = p_store_id;
  if v is not null and jsonb_typeof(v) = 'boolean' then return (v #>> '{}')::boolean; end if;
  return u.role = 'manager' or (u.role = 'cashier' and p_action in ('cancelar_item', 'cancelar_pedido'));
end;
$function$;

-- Parte comum: marca o item cancelado e grava a ocorrência (antes ficava dentro de cancel_order_item_secure).
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
                               'motivo', nullif(btrim(coalesce(p_reason, '')), '')) || coalesce(p_extra, '{}'::jsonb));
  end if;
  return v_store_id is not null;
end;
$function$;
revoke all on function public._cancelar_item_registrado(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public.cancel_order_item_secure(p_item_id uuid, p_operator_user_id uuid default null::uuid, p_operator_name text default null::text, p_reason text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- 161: a função antiga (apps até 1.2.84 ainda a chamam direto) também confere a permissão de quem cancela.
  -- A v2 chama esta com o mesmo operador, então 'cancelar_pedido' (supervisor de caixa pela v2) continua valendo.
  if not (operator_can_secure((select store_id from order_items where id = p_item_id), p_operator_user_id, 'cancelar_item')
       or operator_can_secure((select store_id from order_items where id = p_item_id), p_operator_user_id, 'cancelar_pedido')) then
    raise exception 'Sem permissão: só o gerente cancela item.';
  end if;
  perform _cancelar_item_registrado(p_item_id, p_operator_user_id, p_operator_name, p_reason);
end;
$function$;

create or replace function public.cancel_order_items_autorizado_secure(
  p_item_ids uuid[],
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
  v_lojas uuid[];
  v_store uuid;
  v_locked timestamptz;
  v_count int;
  v_uid uuid;
  v_nome text;
  v_role text;
  v_attempts int;
  v_extra jsonb;
  v_id uuid;
  v_cancelados int := 0;
begin
  if p_action not in ('cancelar_item', 'cancelar_pedido') then p_action := 'cancelar_item'; end if;
  if coalesce(array_length(p_item_ids, 1), 0) = 0 or array_length(p_item_ids, 1) > 200 then
    return jsonb_build_object('success', false, 'error', 'itens');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('success', false, 'error', 'motivo');
  end if;
  if coalesce(p_password, '') = '' then
    return jsonb_build_object('success', false, 'error', 'invalid');
  end if;

  select array_agg(distinct store_id) into v_lojas from order_items where id = any(p_item_ids);
  if coalesce(array_length(v_lojas, 1), 0) <> 1 then
    return jsonb_build_object('success', false, 'error', 'itens');
  end if;
  v_store := v_lojas[1];

  select locked_until into v_locked from store_open_mode_attempts where store_id = v_store;
  if v_locked is not null and v_locked > now() then
    return jsonb_build_object('success', false, 'error', 'locked', 'seconds', ceil(extract(epoch from v_locked - now())));
  end if;

  -- Quem é o dono da senha (mesma regra de verify_store_staff_password_secure); senão, a conta universal.
  select count(*) into v_count from store_users
   where store_id = v_store and role <> 'open' and not must_change_password and password = p_password;
  if v_count > 1 then
    return jsonb_build_object('success', false, 'error', 'ambiguous');
  elsif v_count = 1 then
    select id, name, role into v_uid, v_nome, v_role from store_users
     where store_id = v_store and role <> 'open' and not must_change_password and password = p_password;
  else
    select id, name, 'universal' into v_uid, v_nome, v_role from universal_users
     where not must_change_password and password = p_password
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

  v_extra := jsonb_build_object('autorizado_por', v_nome)
          || case when nullif(btrim(coalesce(p_solicitado_por, '')), '') is not null and btrim(p_solicitado_por) <> v_nome
                  then jsonb_build_object('solicitado_por', btrim(p_solicitado_por)) else '{}'::jsonb end;
  foreach v_id in array p_item_ids loop
    if _cancelar_item_registrado(v_id, case when v_role = 'universal' then null else v_uid end, v_nome, btrim(p_reason), v_extra) then
      v_cancelados := v_cancelados + 1;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'user_id', v_uid, 'name', v_nome, 'role', v_role, 'cancelados', v_cancelados);
end;
$function$;
grant execute on function public.cancel_order_items_autorizado_secure(uuid[], text, text, text, text) to anon, authenticated;

create or replace function public.copy_store_user_to_store_secure(p_user_id uuid, p_store_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  u store_users%rowtype;
  v_novo uuid;
begin
  select * into u from store_users where id = p_user_id;
  if not found then return jsonb_build_object('success', false, 'message', 'Usuário não encontrado.'); end if;
  if not exists (select 1 from stores where id = p_store_id) then return jsonb_build_object('success', false, 'message', 'Loja não encontrada.'); end if;
  if u.store_id = p_store_id then return jsonb_build_object('success', false, 'message', 'Esse login já é dessa loja.'); end if;
  if exists (select 1 from store_users where store_id = p_store_id and lower(btrim(email)) = lower(btrim(u.email))) then
    return jsonb_build_object('success', false, 'message', 'Esse e-mail já tem login nessa loja.');
  end if;
  begin
    insert into store_users (store_id, name, email, password, role, must_change_password, permissions, photo_url)
    values (p_store_id, u.name, btrim(u.email), u.password, u.role, u.must_change_password, u.permissions, u.photo_url)
    returning id into v_novo;
  exception when others then
    -- senha repetida na loja de destino (trigger da 158) e afins
    return jsonb_build_object('success', false, 'message', sqlerrm);
  end;
  return jsonb_build_object('success', true, 'id', v_novo);
end;
$function$;
grant execute on function public.copy_store_user_to_store_secure(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
