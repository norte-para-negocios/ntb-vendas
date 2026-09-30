-- Modo "Aberto" (30/09, pedido do dono): um computador fica logado num perfil
-- role='open' que só mexe em Mesas. Ao confirmar um pedido, a pessoa digita só a
-- própria senha; se ela bater com UMA conta da loja, o pedido sai no nome dessa conta.
-- Não cria sessão. Contas role='open' e contas que ainda não trocaram a senha inicial
-- (must_change_password) não entram. Senha igual em mais de uma conta = 'ambiguous'
-- (pede pra entrar com o login). Trava por loja: 10 erros seguidos = 1 min bloqueado.
create table if not exists store_open_mode_attempts (
  store_id uuid primary key references stores(id) on delete cascade,
  attempts int not null default 0,
  locked_until timestamptz
);
alter table store_open_mode_attempts enable row level security;
revoke all on store_open_mode_attempts from anon, authenticated;

create or replace function verify_store_staff_password_secure(p_store_id uuid, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
   where store_id = p_store_id and role <> 'open' and not must_change_password and password = p_password;

  if v_count = 1 then
    select id, name, role into v_user from store_users
     where store_id = p_store_id and role <> 'open' and not must_change_password and password = p_password;
    delete from store_open_mode_attempts where store_id = p_store_id;
    return jsonb_build_object('success', true, 'user_id', v_user.id, 'name', v_user.name, 'role', v_user.role);
  end if;

  if v_count > 1 then
    return jsonb_build_object('success', false, 'error', 'ambiguous');
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

grant execute on function verify_store_staff_password_secure(uuid, text) to anon, authenticated;
