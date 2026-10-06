-- 166 — Garçom confirma o pedido com NOME + SENHA (06/10/2026). Aditiva: as funções antigas (só senha) continuam para os
-- apps antigos. As senhas atuais não mudam: a conferência usa a mesma coluna e o mesmo limite de tentativas da 135/158.
-- Lista de quem pode lançar pedido: todo usuário da loja, menos o perfil "open" e quem ainda não trocou a senha inicial.
create or replace function public.list_store_staff_for_orders_secure(p_store_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role) order by lower(name)), '[]'::jsonb)
  from store_users
  where store_id = p_store_id and role <> 'open' and not must_change_password;
$$;

create or replace function public.verify_store_staff_login_secure(p_store_id uuid, p_user_id uuid, p_password text)
returns jsonb language plpgsql security definer set search_path = public as $$
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
   where id = p_user_id and store_id = p_store_id and role <> 'open' and not must_change_password and password = p_password;

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
$$;

grant execute on function public.list_store_staff_for_orders_secure(uuid) to anon, authenticated;
grant execute on function public.verify_store_staff_login_secure(uuid, uuid, text) to anon, authenticated;
notify pgrst, 'reload schema';
