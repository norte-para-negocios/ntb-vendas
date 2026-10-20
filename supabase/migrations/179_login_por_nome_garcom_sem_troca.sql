-- 179: login com e-mail OU nome, e garçom sem "troca obrigatória de senha" (20/10/2026).
-- Reclamação do dono ("muita gente sem conseguir fazer login"; garçom no celular "se quiser fazer login faz, mas cai na tela de
-- mesas"). Achados na ODARA: o cadastro de Garçom esconde o campo E-mail, então o e-mail da pessoa foi digitado no campo Nome
-- (o login dela virou garcom-xxxx@interno e "Usuário ou senha incorretos"); e todo cadastro/troca de senha marcava
-- must_change_password, que tira a senha da confirmação do pedido (verify_store_staff_password_secure) até a pessoa entrar e
-- trocar. Garçom que nunca entra no celular ficava sem conseguir lançar com a própria senha.
-- * authenticate_store_user_secure: e-mail ou nome (sem diferenciar maiúscula/espaço). Senha é única por loja (158), então
--   nome repetido não confunde; em várias lojas continua "Qual loja você quer acessar?" (177).
-- * Garçom: criado e com senha trocada pelo gerente SEM troca obrigatória (os outros perfis continuam trocando no 1º acesso).

CREATE OR REPLACE FUNCTION public.authenticate_store_user_secure(p_email text, p_password text, p_store_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- 179: o campo aceita o e-mail OU o nome da pessoa (garçom sem e-mail, ou e-mail digitado no campo Nome do cadastro).
  v_email text := lower(regexp_replace(btrim(coalesce(p_email, '')), '\s+', ' ', 'g'));
  v_cand int;
  v_livres int;
  v_ok uuid[];
  v_user store_users%rowtype;
  v_lojas jsonb;
begin
  if v_email = '' or coalesce(p_password, '') = '' then
    return jsonb_build_object('success', false);
  end if;

  -- trava as linhas do e-mail (mesmo "for update" de antes, agora em todas as lojas dele)
  perform 1 from store_users
   where (lower(btrim(email)) = v_email or lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = v_email) and (p_store_id is null or store_id = p_store_id)
   for update;
  get diagnostics v_cand = row_count;
  if v_cand = 0 then
    return jsonb_build_object('success', false);
  end if;

  select count(*) into v_livres from store_users
   where (lower(btrim(email)) = v_email or lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = v_email) and (p_store_id is null or store_id = p_store_id)
     and (login_locked_until is null or login_locked_until <= now());
  if v_livres = 0 then
    return jsonb_build_object('success', false, 'locked', true);
  end if;

  -- linhas cuja senha confere, não bloqueadas, de loja ativa
  select array_agg(u.id order by u.created_at) into v_ok
    from store_users u join stores s on s.id = u.store_id
   where (lower(btrim(u.email)) = v_email or lower(regexp_replace(btrim(u.name), '\s+', ' ', 'g')) = v_email) and (p_store_id is null or u.store_id = p_store_id)
     and (u.login_locked_until is null or u.login_locked_until <= now())
     and u.password = p_password
     and coalesce(s.is_active, true);

  if v_ok is null then
    -- senha errada (ou loja inativa): conta tentativa nas linhas não bloqueadas, como antes
    update store_users set
      login_attempts = login_attempts + 1,
      login_locked_until = case when login_attempts + 1 >= 5 then now() + interval '5 minutes' else login_locked_until end
    where (lower(btrim(email)) = v_email or lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = v_email) and (p_store_id is null or store_id = p_store_id)
      and (login_locked_until is null or login_locked_until <= now());
    return jsonb_build_object('success', false);
  end if;

  update store_users set login_attempts = 0, login_locked_until = null where id = any(v_ok);

  if array_length(v_ok, 1) > 1 then
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name) into v_lojas
      from store_users u join stores s on s.id = u.store_id
     where u.id = any(v_ok);
    return jsonb_build_object('success', false, 'escolher_loja', true, 'lojas', v_lojas);
  end if;

  select * into v_user from store_users where id = v_ok[1];
  return jsonb_build_object(
    'success', true,
    'mustChangePass', v_user.must_change_password,
    'user', jsonb_build_object('id', v_user.id, 'store_id', v_user.store_id, 'name', v_user.name,
      'email', v_user.email, 'role', v_user.role, 'permissions', v_user.permissions,
      'assigned_table_ids', v_user.assigned_table_ids, 'photo_url', v_user.photo_url)
  );
end;
$function$;

create or replace function public.create_store_team_member_secure(p_store_id uuid, p_name text, p_email text, p_password text, p_role text, p_permissions jsonb, p_assigned_table_ids uuid[] default null::uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into store_users (store_id, name, email, password, role, permissions, must_change_password, assigned_table_ids)
  values (p_store_id, p_name, p_email, p_password, p_role, p_permissions, p_role <> 'waiter', p_assigned_table_ids)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('success', false, 'message', 'Este e-mail já está cadastrado nesta loja.');
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_store_user_secure(p_user_id uuid, p_updates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update store_users set
    name = coalesce(p_updates->>'name', name),
    email = coalesce(p_updates->>'email', email),
    store_id = coalesce((p_updates->>'store_id')::uuid, store_id),
    role = coalesce(p_updates->>'role', role),
    permissions = coalesce(p_updates->'permissions', permissions),
    password = coalesce(p_updates->>'password', password),
    photo_url = case when p_updates ? 'photo_url' then p_updates->>'photo_url' else photo_url end,
    assigned_table_ids = case
      when p_updates ? 'assigned_table_ids' then (
        case
          when p_updates->'assigned_table_ids' is null
            or jsonb_typeof(p_updates->'assigned_table_ids') = 'null'
            or jsonb_array_length(p_updates->'assigned_table_ids') = 0
          then null
          else (select array_agg(x::uuid) from jsonb_array_elements_text(p_updates->'assigned_table_ids') x)
        end
      )
      else assigned_table_ids
    end,
    must_change_password = case
      when p_updates ? 'password' then coalesce(p_updates->>'role', role) <> 'waiter'
      when p_updates ? 'must_change_password' then (p_updates->>'must_change_password')::boolean
      else must_change_password
    end
  where id = p_user_id;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Usuário não encontrado.');
  end if;
  return jsonb_build_object('success', true);
exception when unique_violation then
  return jsonb_build_object('success', false, 'message', 'Este e-mail já está em uso.');
end;
$function$;

notify pgrst, 'reload schema';
