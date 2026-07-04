-- Fecha um vazamento real e grave: store_users/system_admins tinham
-- policy "allow_all_anon" FOR ALL, ou seja, qualquer um com a chave
-- anonima publica (embutida em qualquer navegador que abre o cardapio)
-- conseguia rodar "select email, password from store_users" e ler a
-- senha em texto puro de TODOS os lojistas de TODAS as lojas reais, mais
-- a senha do Master Admin. Confirmado testando direto (nao teorico):
-- vieram senhas reais de lojas de cliente numa consulta simples.
--
-- A comparacao de senha no login ja rodava em RPC security definer
-- (authenticate_admin_secure/authenticate_store_user_secure, migration
-- 008), mas isso nao adianta nada se a tabela inteira continua legivel
-- direto por qualquer um: da pra pular o login e ler a senha na fonte.
--
-- Correcao: nenhuma policy sobra pra anon/authenticated nessas 2 tabelas
-- (nem SELECT, nem INSERT, nem UPDATE, nem DELETE). Toda leitura e
-- escrita passa a rodar por dentro de functions security definer, que
-- rodam com privilegio do dono da function (bypassa RLS) e nunca
-- devolvem a senha pro client.

drop policy if exists "allow_all_anon" on store_users;
drop policy if exists "allow_all_anon" on system_admins;

-- ─── Troca de senha (fluxo de primeiro acesso obrigatorio) ────────────────────

create or replace function public.update_admin_password_secure(p_user_id uuid, p_new_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update system_admins set password = p_new_password, must_change_password = false where id = p_user_id;
end;
$$;

grant execute on function public.update_admin_password_secure(uuid, text) to anon, authenticated;

create or replace function public.update_store_user_password_secure(p_user_id uuid, p_new_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update store_users set password = p_new_password, must_change_password = false where id = p_user_id;
end;
$$;

grant execute on function public.update_store_user_password_secure(uuid, text) to anon, authenticated;

-- ─── Leitura (nunca devolve a coluna password) ────────────────────────────────

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
    'role', v_user.role, 'must_change_password', v_user.must_change_password, 'permissions', v_user.permissions
  );
end;
$$;

grant execute on function public.fetch_store_user_by_id_secure(uuid) to anon, authenticated;

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
      'role', role, 'must_change_password', must_change_password, 'permissions', permissions
    ) order by name)
    from store_users where store_id = p_store_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.fetch_store_team_members_secure(uuid) to anon, authenticated;

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
      'created_at', su.created_at, 'store', to_jsonb(s.*)
    ) order by su.created_at desc)
    from store_users su join stores s on s.id = su.store_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.fetch_all_store_users_secure() to anon, authenticated;

-- ─── Escrita (criar/editar/apagar usuario) ─────────────────────────────────────

create or replace function public.create_store_team_member_secure(
  p_store_id uuid, p_name text, p_email text, p_password text, p_role text, p_permissions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into store_users (store_id, name, email, password, role, permissions, must_change_password)
  values (p_store_id, p_name, p_email, p_password, p_role, p_permissions, true)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('success', false, 'message', 'Este e-mail já está cadastrado nesta loja.');
end;
$$;

grant execute on function public.create_store_team_member_secure(uuid, text, text, text, text, jsonb) to anon, authenticated;

-- p_updates aceita qualquer subconjunto de: name, email, store_id, role,
-- permissions, password, must_change_password. Se "password" vier
-- preenchido, forca must_change_password=true (mesmo comportamento que
-- o client antigo já tinha pra troca de senha administrativa).
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

grant execute on function public.update_store_user_secure(uuid, jsonb) to anon, authenticated;

create or replace function public.delete_store_user_secure(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from store_users where id = p_user_id;
  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.delete_store_user_secure(uuid) to anon, authenticated;
