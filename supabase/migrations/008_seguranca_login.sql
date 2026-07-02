-- Track M / Task M2 — rate-limit de login (admin + lojista).

alter table system_admins add column if not exists login_attempts int not null default 0;
alter table system_admins add column if not exists login_locked_until timestamptz;
alter table store_users add column if not exists login_attempts int not null default 0;
alter table store_users add column if not exists login_locked_until timestamptz;

create or replace function public.authenticate_admin_secure(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  return jsonb_build_object('success', true, 'mustChangePass', v_admin.must_change_password, 'userId', v_admin.id);
end;
$$;

grant execute on function public.authenticate_admin_secure(text, text) to anon, authenticated;

create or replace function public.authenticate_store_user_secure(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user store_users%rowtype;
begin
  select * into v_user from store_users where email = p_email for update;
  if not found then
    return jsonb_build_object('success', false);
  end if;

  if v_user.login_locked_until is not null and v_user.login_locked_until > now() then
    return jsonb_build_object('success', false, 'locked', true);
  end if;

  if v_user.password <> p_password then
    update store_users set
      login_attempts = login_attempts + 1,
      login_locked_until = case when login_attempts + 1 >= 5 then now() + interval '5 minutes' else login_locked_until end
    where id = v_user.id;
    return jsonb_build_object('success', false);
  end if;

  update store_users set login_attempts = 0, login_locked_until = null where id = v_user.id;
  return jsonb_build_object(
    'success', true,
    'mustChangePass', v_user.must_change_password,
    'user', jsonb_build_object('id', v_user.id, 'store_id', v_user.store_id, 'name', v_user.name,
      'email', v_user.email, 'role', v_user.role, 'permissions', v_user.permissions)
  );
end;
$$;

grant execute on function public.authenticate_store_user_secure(text, text) to anon, authenticated;
