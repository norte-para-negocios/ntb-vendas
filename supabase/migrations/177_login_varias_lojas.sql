-- 177: o mesmo e-mail pode ter login em mais de uma loja (13/10/2026, pedido do dono: "a Thaise tem login no Sertão
-- e também tem que ter um na ODARA"). Antes store_users.email era único na plataforma inteira.
--
-- * E-mail passa a ser único POR LOJA (sem diferenciar maiúscula/minúscula nem espaços nas pontas).
-- * authenticate_store_user_secure ganha p_store_id opcional:
--   - com p_store_id: entra só naquela loja (tela "Qual loja?" e a rota do kit da nota sem internet);
--   - sem p_store_id e a senha confere em UMA loja ativa: entra direto, igual antes;
--   - sem p_store_id e confere em VÁRIAS: devolve success=false + escolher_loja=true + lojas [{id, name}] (só depois de a
--     senha conferir, então não revela nada a quem não sabe a senha). App antigo lê isso como "senha errada"; o app novo
--     mostra a escolha. Quem tem senhas diferentes em cada loja entra direto até no app antigo.
-- * Bloqueio por tentativas continua por linha (5 erros = 5 min). Erro conta em todas as linhas do e-mail.
-- Aditiva: logins de hoje (um e-mail = uma loja) seguem idênticos.

alter table public.store_users drop constraint if exists store_users_email_key;
create unique index if not exists store_users_loja_email_key on public.store_users (store_id, lower(btrim(email)));
create index if not exists idx_store_users_email_norm on public.store_users (lower(btrim(email)));

drop function if exists public.authenticate_store_user_secure(text, text);

create or replace function public.authenticate_store_user_secure(p_email text, p_password text, p_store_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
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
   where lower(btrim(email)) = v_email and (p_store_id is null or store_id = p_store_id)
   for update;
  get diagnostics v_cand = row_count;
  if v_cand = 0 then
    return jsonb_build_object('success', false);
  end if;

  select count(*) into v_livres from store_users
   where lower(btrim(email)) = v_email and (p_store_id is null or store_id = p_store_id)
     and (login_locked_until is null or login_locked_until <= now());
  if v_livres = 0 then
    return jsonb_build_object('success', false, 'locked', true);
  end if;

  -- linhas cuja senha confere, não bloqueadas, de loja ativa
  select array_agg(u.id order by u.created_at) into v_ok
    from store_users u join stores s on s.id = u.store_id
   where lower(btrim(u.email)) = v_email and (p_store_id is null or u.store_id = p_store_id)
     and (u.login_locked_until is null or u.login_locked_until <= now())
     and u.password = p_password
     and coalesce(s.is_active, true);

  if v_ok is null then
    -- senha errada (ou loja inativa): conta tentativa nas linhas não bloqueadas, como antes
    update store_users set
      login_attempts = login_attempts + 1,
      login_locked_until = case when login_attempts + 1 >= 5 then now() + interval '5 minutes' else login_locked_until end
    where lower(btrim(email)) = v_email and (p_store_id is null or store_id = p_store_id)
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

grant execute on function public.authenticate_store_user_secure(text, text, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
