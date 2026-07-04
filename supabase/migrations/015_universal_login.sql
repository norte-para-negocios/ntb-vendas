-- Conta universal: um login único que, em vez de cair direto numa loja
-- (como store_users), deixa escolher qual loja acessar a cada entrada.
-- Já nasce sem nenhuma policy de anon (mesmo motivo da
-- 014_fecha_vazamento_senhas.sql): toda leitura/escrita passa por RPC
-- security definer desde o início, nunca acesso direto à tabela.

create table if not exists universal_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password text not null,
  must_change_password boolean not null default true,
  login_attempts int not null default 0,
  login_locked_until timestamptz,
  created_at timestamptz not null default now()
);

alter table universal_users enable row level security;
-- Nenhuma policy criada de propósito: anon não acessa esta tabela de jeito nenhum.

create or replace function public.authenticate_universal_user_secure(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    'user', jsonb_build_object('id', v_user.id, 'name', v_user.name, 'email', v_user.email)
  );
end;
$$;

grant execute on function public.authenticate_universal_user_secure(text, text) to anon, authenticated;

create or replace function public.update_universal_user_password_secure(p_user_id uuid, p_new_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update universal_users set password = p_new_password, must_change_password = false where id = p_user_id;
end;
$$;

grant execute on function public.update_universal_user_password_secure(uuid, text) to anon, authenticated;

create or replace function public.fetch_universal_user_by_id_secure(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user universal_users%rowtype;
begin
  select * into v_user from universal_users where id = p_user_id;
  if not found then return null; end if;
  return jsonb_build_object('id', v_user.id, 'name', v_user.name, 'email', v_user.email);
end;
$$;

grant execute on function public.fetch_universal_user_by_id_secure(uuid) to anon, authenticated;

-- Semente: uma conta universal inicial (senha provisória, forçada a trocar no primeiro acesso).
insert into universal_users (name, email, password, must_change_password)
values ('Equipe Norte Para Negócios', 'equipe@norteparanegocios.com.br', 'trocar-na-primeira-vez', true)
on conflict (email) do nothing;
