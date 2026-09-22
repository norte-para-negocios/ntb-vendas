-- 078_foto_perfil_operador.sql
--
-- "Meu Perfil" (2026-09-22, pedido direto): cada operador (store_user) pode
-- trocar o próprio nome e subir uma foto de perfil, exibida no medalhão do
-- cabeçalho do Caixa (antes só tinha a inicial do nome, hash de cor —
-- ProductThumb, componente compartilhado com o cardápio). A foto em si é
-- upload público via Cloudinary (mesmo mecanismo já usado pra logo da loja
-- e foto de produto, lib/api.ts uploadToCloudinary) — aqui só a URL.
--
-- Não é dado sensível (mesma classe de `name`/`email`, que já é allow_all_anon
-- de escrita via RPC nesta tabela desde a migration 014) — só mais uma coluna
-- no mesmo padrão, sem tabela nova.

alter table store_users add column if not exists photo_url text;

-- Os 4 pontos que já leem/escrevem store_users por RPC (nenhuma mudança de
-- assinatura — só os campos retornados/aceitos, CREATE OR REPLACE simples):

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
      'email', v_user.email, 'role', v_user.role, 'permissions', v_user.permissions,
      'assigned_table_ids', v_user.assigned_table_ids, 'photo_url', v_user.photo_url)
  );
end;
$$;

create or replace function public.fetch_store_user_by_id_secure(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user store_users%rowtype;
begin
  select * into v_user from store_users where id = p_user_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_user.id, 'store_id', v_user.store_id, 'name', v_user.name, 'email', v_user.email,
    'role', v_user.role, 'must_change_password', v_user.must_change_password, 'permissions', v_user.permissions,
    'assigned_table_ids', v_user.assigned_table_ids, 'photo_url', v_user.photo_url
  );
end;
$$;

create or replace function public.fetch_store_team_members_secure(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'store_id', store_id, 'name', name, 'email', email,
      'role', role, 'must_change_password', must_change_password, 'permissions', permissions,
      'assigned_table_ids', assigned_table_ids, 'photo_url', photo_url
    ) order by name)
    from store_users where store_id = p_store_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.fetch_all_store_users_secure()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', su.id, 'store_id', su.store_id, 'name', su.name, 'email', su.email,
      'role', su.role, 'must_change_password', su.must_change_password, 'permissions', su.permissions,
      'assigned_table_ids', su.assigned_table_ids, 'photo_url', su.photo_url,
      'created_at', su.created_at, 'store', to_jsonb(s.*)
    ) order by su.created_at desc)
    from store_users su join stores s on s.id = su.store_id
  ), '[]'::jsonb);
end;
$$;

-- update_store_user_secure(uuid, jsonb) já aceita qualquer campo via merge
-- (coalesce a partir de p_updates) — só falta incluir photo_url na lista.
create or replace function public.update_store_user_secure(p_user_id uuid, p_updates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
      when p_updates ? 'password' then true
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
$$;

grant execute on function public.authenticate_store_user_secure(text, text) to anon, authenticated;
grant execute on function public.fetch_store_user_by_id_secure(uuid) to anon, authenticated;
grant execute on function public.fetch_store_team_members_secure(uuid) to anon, authenticated;
grant execute on function public.fetch_all_store_users_secure() to anon, authenticated;
grant execute on function public.update_store_user_secure(uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
