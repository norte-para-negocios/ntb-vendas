-- 180: a senha que o gerente cadastrou vale para confirmar pedido NA HORA, e o erro diz o motivo (20/10/2026).
-- Reclamação do Ramon (ODARA): garçom cadastrado, "senha errada" no pedido. Causas reais: conta com "trocar senha no primeiro acesso"
-- era ignorada pela confirmação do pedido; conta cadastrada como "Aberto" (conta do PC do salão) também; e a tela só dizia "senha
-- incorreta". Agora:
-- * confirmação do pedido aceita qualquer pessoa da loja, tenha ou não trocado a senha (a senha continua única por loja, 158; se
--   duas contas ainda com a senha provisória repetida baterem, devolve 'ambiguous' e a tela pede o nome);
-- * senha que só existe numa conta "Aberto" devolve 'conta_aberta' (a tela explica) em vez de "incorreta".
create or replace function public.verify_store_staff_password_secure(p_store_id uuid, p_password text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_locked timestamptz;
  v_count int;
  v_user record;
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

  if v_count = 1 then
    select id, name, role into v_user from store_users
     where store_id = p_store_id and role <> 'open' and password = p_password;
    delete from store_open_mode_attempts where store_id = p_store_id;
    return jsonb_build_object('success', true, 'user_id', v_user.id, 'name', v_user.name, 'role', v_user.role);
  end if;

  if v_count > 1 then
    return jsonb_build_object('success', false, 'error', 'ambiguous');
  end if;

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
end;
$function$;

-- Mesmo critério nas outras três portas da senha de equipe: lista de nomes do pedido, "toque no seu nome" e cancelar com senha (178).
CREATE OR REPLACE FUNCTION public.list_store_staff_for_orders_secure(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role) order by lower(name)), '[]'::jsonb)
  from store_users
  where store_id = p_store_id and role <> 'open';
$function$;

CREATE OR REPLACE FUNCTION public.verify_store_staff_login_secure(p_store_id uuid, p_user_id uuid, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_locked timestamptz;
  v_user record;
  v_attempts int;
begin
  if p_store_id is null or p_user_id is null or coalesce(p_password, '') = '' then
    return jsonb_build_object('success', false, 'error', 'invalid');
  end if;

  select locked_until into v_locked from store_open_mode_attempts where store_id = p_store_id;
  if v_locked is not null and v_locked > now() then
    return jsonb_build_object('success', false, 'error', 'locked', 'seconds', ceil(extract(epoch from v_locked - now())));
  end if;

  select id, name, role into v_user from store_users
   where id = p_user_id and store_id = p_store_id and role <> 'open' and password = p_password;

  if found then
    delete from store_open_mode_attempts where store_id = p_store_id;
    return jsonb_build_object('success', true, 'user_id', v_user.id, 'name', v_user.name, 'role', v_user.role);
  end if;

  insert into store_open_mode_attempts (store_id, attempts) values (p_store_id, 1)
  on conflict (store_id) do update set attempts = store_open_mode_attempts.attempts + 1
  returning attempts into v_attempts;
  if v_attempts >= 10 then
    update store_open_mode_attempts set attempts = 0, locked_until = now() + interval '1 minute' where store_id = p_store_id;
  end if;
  return jsonb_build_object('success', false, 'error', 'invalid');
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_order_items_autorizado_secure(p_item_ids uuid[], p_password text, p_reason text, p_action text DEFAULT 'cancelar_item'::text, p_solicitado_por text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

notify pgrst, 'reload schema';
