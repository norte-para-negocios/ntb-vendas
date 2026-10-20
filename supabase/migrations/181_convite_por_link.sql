-- 181: convite por link (20/10/2026, pedido do dono): o gerente escolhe nome, função e permissões, manda o LINK, e a pessoa cria o
-- próprio login e a própria senha. Acaba a senha provisória (123456 repetida, "senha já cadastrada", "senha errada" no 1º acesso).
-- A senha continua única por loja (158): se a pessoa escolher uma senha já usada na loja, a tela pede outra, sem dizer de quem é.
create table if not exists public.store_user_invites (
  token text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  role text not null check (role in ('waiter', 'cashier', 'cook', 'attendant', 'manager')),
  permissions jsonb not null default '{}'::jsonb,
  assigned_table_ids uuid[],
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  created_user_id uuid
);
alter table public.store_user_invites enable row level security;
revoke all on public.store_user_invites from anon, authenticated;

create or replace function public.create_store_user_invite_secure(p_store_id uuid, p_name text, p_role text, p_permissions jsonb, p_assigned_table_ids uuid[] default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_token text;
begin
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
end;
$function$;

create or replace function public.get_store_user_invite_secure(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare i store_user_invites%rowtype; v_loja text;
begin
  select * into i from store_user_invites where token = p_token;
  if not found then return jsonb_build_object('success', false, 'error', 'invalido'); end if;
  if i.used_at is not null then return jsonb_build_object('success', false, 'error', 'usado'); end if;
  if i.expires_at < now() then return jsonb_build_object('success', false, 'error', 'expirado'); end if;
  select name into v_loja from stores where id = i.store_id;
  return jsonb_build_object('success', true, 'name', i.name, 'role', i.role, 'store_name', v_loja);
end;
$function$;

create or replace function public.accept_store_user_invite_secure(p_token text, p_email text, p_password text, p_name text default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  i store_user_invites%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nome text;
  v_id uuid;
begin
  select * into i from store_user_invites where token = p_token for update;
  if not found then return jsonb_build_object('success', false, 'error', 'invalido', 'message', 'Convite não encontrado.'); end if;
  if i.used_at is not null then return jsonb_build_object('success', false, 'error', 'usado', 'message', 'Este convite já foi usado.'); end if;
  if i.expires_at < now() then return jsonb_build_object('success', false, 'error', 'expirado', 'message', 'Este convite venceu. Peça outro ao gerente.'); end if;
  if length(coalesce(p_password, '')) < 6 then
    return jsonb_build_object('success', false, 'error', 'senha', 'message', 'A senha precisa ter pelo menos 6 caracteres.');
  end if;
  v_nome := coalesce(nullif(btrim(coalesce(p_name, '')), ''), i.name);
  if position('@' in v_nome) > 0 then
    return jsonb_build_object('success', false, 'error', 'nome', 'message', 'No campo Nome, coloque o seu nome (o e-mail vai no campo E-mail).');
  end if;
  if v_email = '' then
    if i.role <> 'waiter' then
      return jsonb_build_object('success', false, 'error', 'email', 'message', 'Coloque o seu e-mail.');
    end if;
    v_email := 'garcom-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) || '@interno.norteparanegocios.com.br';
  elsif v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('success', false, 'error', 'email', 'message', 'Esse e-mail não parece certo.');
  end if;
  begin
    insert into store_users (store_id, name, email, password, role, permissions, must_change_password, assigned_table_ids)
    values (i.store_id, v_nome, v_email, p_password, i.role, i.permissions, false, i.assigned_table_ids)
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'error', 'email', 'message', 'Esse e-mail já tem login nesta loja.');
    when others then
      if sqlerrm like '%senha%' then
        return jsonb_build_object('success', false, 'error', 'senha', 'message', 'Essa senha já está em uso por outra pessoa. Escolha outra.');
      end if;
      raise;
  end;
  update store_user_invites set used_at = now(), created_user_id = v_id where token = p_token;
  return jsonb_build_object('success', true, 'email', case when v_email like '%@interno.norteparanegocios.com.br' then null else v_email end, 'name', v_nome);
end;
$function$;

grant execute on function public.create_store_user_invite_secure(uuid, text, text, jsonb, uuid[]) to anon, authenticated;
grant execute on function public.get_store_user_invite_secure(text) to anon, authenticated;
grant execute on function public.accept_store_user_invite_secure(text, text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
