-- 182: sessão no servidor para contas e senhas (20/10/2026, auditoria de login).
-- Antes, criar/editar/apagar login e trocar senha aceitavam qualquer chamada que soubesse o ID da pessoa ou da loja.
-- Agora o login devolve um 'token' e essas funções conferem se quem chama é gestor da loja (ou Master).
-- Entra DESLIGADO (seg_flags.exigir_sessao = false): quem ainda não tem token (apps antigos, sessão aberta antes) segue
-- funcionando. Liga com: update seg_flags set valor = true where chave = 'exigir_sessao';
create table if not exists public.seg_flags (chave text primary key, valor boolean not null default false);
insert into public.seg_flags (chave, valor) values ('exigir_sessao', false) on conflict do nothing;
alter table public.seg_flags enable row level security;

create table if not exists public.sessoes_app (
  token text primary key,
  tipo text not null check (tipo in ('loja', 'universal', 'admin')),
  user_id uuid not null,
  store_id uuid,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '30 days'
);
create index if not exists sessoes_app_user on public.sessoes_app (user_id);
alter table public.sessoes_app enable row level security;

create or replace function public._emitir_sessao(p_tipo text, p_user uuid, p_store uuid) returns text
language plpgsql security definer set search_path to 'public' as $$
declare v text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  delete from sessoes_app where expira_em < now();
  delete from sessoes_app where user_id = p_user and token not in (select token from sessoes_app where user_id = p_user order by criado_em desc limit 19);
  insert into sessoes_app (token, tipo, user_id, store_id) values (v, p_tipo, p_user, p_store);
  return v;
end $$;

-- true se a chamada pode seguir. p_loja = loja alvo; p_alvo = pessoa alvo; p_proprio = pode ser a própria pessoa.
create or replace function public._sessao_ok(p_token text, p_loja uuid, p_alvo uuid default null, p_proprio boolean default false) returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare s sessoes_app%rowtype; u store_users%rowtype;
begin
  if not coalesce((select valor from seg_flags where chave = 'exigir_sessao'), false) then return true; end if;
  if p_token is null then return false; end if;
  select * into s from sessoes_app where token = p_token and expira_em > now();
  if not found then return false; end if;
  if s.tipo in ('admin', 'universal') then return true; end if;
  if p_proprio and p_alvo is not null and s.user_id = p_alvo then return true; end if;
  select * into u from store_users where id = s.user_id;
  if not found or u.store_id is distinct from p_loja then return false; end if;
  return u.role in ('owner', 'manager') or coalesce(u.permissions->>'admin', '') = 'true';
end $$;
revoke all on function public._emitir_sessao(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public._sessao_ok(text, uuid, uuid, boolean) from public, anon, authenticated;

-- ---- logins devolvem o token ----
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
      'assigned_table_ids', v_user.assigned_table_ids, 'photo_url', v_user.photo_url),
     'token', public._emitir_sessao('loja', v_user.id, v_user.store_id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.authenticate_universal_user_secure(p_email text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user universal_users%rowtype;
begin
  select * into v_user from universal_users where email = p_email for update;
  if not found then
    return jsonb_build_object('success', false);
  end if;

  if v_user.login_locked_until is not null and v_user.login_locked_until > now() then
    return jsonb_build_object('success', false, 'locked', true);
  end if;

  if v_user.password <> p_password then
    update universal_users set
      login_attempts = login_attempts + 1,
      login_locked_until = case when login_attempts + 1 >= 5 then now() + interval '5 minutes' else login_locked_until end
    where id = v_user.id;
    return jsonb_build_object('success', false);
  end if;

  update universal_users set login_attempts = 0, login_locked_until = null where id = v_user.id;
  return jsonb_build_object(
    'success', true,
    'mustChangePass', v_user.must_change_password,
    'user', jsonb_build_object('id', v_user.id, 'name', v_user.name, 'email', v_user.email, 'pode_ver_lojas_teste', v_user.pode_ver_lojas_teste),
    'token', public._emitir_sessao('universal', v_user.id, null)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.authenticate_admin_secure(p_username text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin system_admins%rowtype;
begin
  select * into v_admin from system_admins where username = p_username for update;
  if not found then
    return jsonb_build_object('success', false);
  end if;

  if v_admin.login_locked_until is not null and v_admin.login_locked_until > now() then
    return jsonb_build_object('success', false, 'locked', true);
  end if;

  if v_admin.password <> p_password then
    update system_admins set
      login_attempts = login_attempts + 1,
      login_locked_until = case when login_attempts + 1 >= 5 then now() + interval '5 minutes' else login_locked_until end
    where id = v_admin.id;
    return jsonb_build_object('success', false);
  end if;

  update system_admins set login_attempts = 0, login_locked_until = null where id = v_admin.id;
  return jsonb_build_object('success', true, 'mustChangePass', v_admin.must_change_password, 'userId', v_admin.id, 'token', public._emitir_sessao('admin', v_admin.id, null));
end;
$function$;

-- ---- funções protegidas (p_token novo e opcional) ----
drop function if exists public.create_store_team_member_secure(uuid, text, text, text, text, jsonb, uuid[]);
create or replace function public.create_store_team_member_secure(p_store_id uuid, p_name text, p_email text, p_password text, p_role text, p_permissions jsonb, p_assigned_table_ids uuid[] default null, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not _sessao_ok(p_token, p_store_id) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  insert into store_users (store_id, name, email, password, role, permissions, must_change_password, assigned_table_ids)
  values (p_store_id, p_name, p_email, p_password, p_role, p_permissions, p_role <> 'waiter', p_assigned_table_ids)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('success', false, 'message', 'Este e-mail já está cadastrado nesta loja.');
end $$;

drop function if exists public.create_store_user_invite_secure(uuid, text, text, jsonb, uuid[]);
create or replace function public.create_store_user_invite_secure(p_store_id uuid, p_name text, p_role text, p_permissions jsonb, p_assigned_table_ids uuid[] default null, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_token text;
begin
  if not _sessao_ok(p_token, p_store_id) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  if p_store_id is null or not exists (select 1 from stores where id = p_store_id) then
    return jsonb_build_object('success', false, 'message', 'Loja não encontrada.');
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    return jsonb_build_object('success', false, 'message', 'Coloque o nome da pessoa.');
  end if;
  if position('@' in p_name) > 0 then
    return jsonb_build_object('success', false, 'message', 'No campo Nome, coloque o nome da pessoa (o e-mail ela coloca ao criar o login).');
  end if;
  if p_role not in ('waiter', 'cashier', 'cook', 'attendant', 'manager') then
    return jsonb_build_object('success', false, 'message', 'Função inválida para convite.');
  end if;
  insert into store_user_invites (store_id, name, role, permissions, assigned_table_ids)
  values (p_store_id, btrim(p_name), p_role, coalesce(p_permissions, '{}'::jsonb), p_assigned_table_ids)
  returning token into v_token;
  return jsonb_build_object('success', true, 'token', v_token);
end $$;

drop function if exists public.update_store_user_secure(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.update_store_user_secure(p_user_id uuid, p_updates jsonb, p_token text default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not _sessao_ok(p_token, (select store_id from store_users where id = p_user_id), p_user_id,
       (select not exists (select 1 from jsonb_object_keys(p_updates) k where k <> 'photo_url'))) then
    return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.');
  end if;
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

drop function if exists public.delete_store_user_secure(uuid);
create or replace function public.delete_store_user_secure(p_user_id uuid, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not _sessao_ok(p_token, (select store_id from store_users where id = p_user_id)) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  delete from store_users where id = p_user_id;
  return jsonb_build_object('success', true);
end $$;

drop function if exists public.copy_store_user_to_store_secure(uuid, uuid);
create or replace function public.copy_store_user_to_store_secure(p_user_id uuid, p_store_id uuid, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u store_users%rowtype; v_novo uuid;
begin
  if not _sessao_ok(p_token, null) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if; -- só Master
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
    return jsonb_build_object('success', false, 'message', sqlerrm);
  end;
  return jsonb_build_object('success', true, 'id', v_novo);
end $$;

drop function if exists public.update_store_user_password_secure(uuid, text);
create or replace function public.update_store_user_password_secure(p_user_id uuid, p_new_password text, p_token text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not _sessao_ok(p_token, (select store_id from store_users where id = p_user_id), p_user_id, true) then raise exception 'sessao_invalida'; end if;
  update store_users set password = p_new_password, must_change_password = false where id = p_user_id;
end $$;

drop function if exists public.update_universal_user_password_secure(uuid, text);
create or replace function public.update_universal_user_password_secure(p_user_id uuid, p_new_password text, p_token text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce((select valor from seg_flags where chave = 'exigir_sessao'), false)
     and not exists (select 1 from sessoes_app where token = p_token and expira_em > now() and (user_id = p_user_id or tipo = 'admin')) then
    raise exception 'sessao_invalida';
  end if;
  update universal_users set password = p_new_password, must_change_password = false where id = p_user_id;
end $$;

drop function if exists public.update_admin_password_secure(uuid, text);
create or replace function public.update_admin_password_secure(p_user_id uuid, p_new_password text, p_token text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce((select valor from seg_flags where chave = 'exigir_sessao'), false)
     and not exists (select 1 from sessoes_app where token = p_token and expira_em > now() and tipo = 'admin' and user_id = p_user_id) then
    raise exception 'sessao_invalida';
  end if;
  update system_admins set password = p_new_password, must_change_password = false where id = p_user_id;
end $$;

drop function if exists public.fetch_all_store_users_secure();
create or replace function public.fetch_all_store_users_secure(p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not _sessao_ok(p_token, null) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', su.id, 'store_id', su.store_id, 'name', su.name, 'email', su.email,
      'role', su.role, 'must_change_password', su.must_change_password, 'permissions', su.permissions,
      'assigned_table_ids', su.assigned_table_ids, 'photo_url', su.photo_url,
      'created_at', su.created_at, 'store', to_jsonb(s.*)
    ) order by su.created_at desc)
    from store_users su join stores s on s.id = su.store_id
  ), '[]'::jsonb);
end $$;

notify pgrst, 'reload schema';
