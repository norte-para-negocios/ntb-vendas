-- Task 3 (2026-08-23, backlog "resolucao-backlog-pendente"): jurisdicao de
-- mesas por garcom/caixa. Duas perguntas de desenho ja resolvidas antes desta
-- migration (nao re-derivar):
-- 1. Mesa fora da jurisdicao do usuario continua VISIVEL (so' bloqueada/
--    acinzentada) — nunca some da tela, senao um garcom perto de uma mesa que
--    nao e' dele nao consegue nem ver o estado dela pra avisar o caixa.
-- 2. Mesa sem NENHUM garcom com jurisdicao atribuida continua visivel pra
--    todos (comportamento de hoje) — jurisdicao e' opt-in, nunca um buraco
--    que deixa mesa orfa.
--
-- Formato escolhido: `assigned_table_ids uuid[]` direto em `store_users`, nao
-- uma tabela de juncao. Verificado antes de escolher: o unico precedente real
-- de array-por-usuario/produto neste projeto e' `product_recommendations`,
-- que E' uma tabela de juncao de verdade — mas por um motivo que nao se
-- aplica aqui (precisa de `position`/ordem, e e' publica/anonima, sem dono
-- "usuario"). Todo outro caso de "conjunto pequeno de ids/valores associado a
-- uma linha" neste projeto (categories.available_days int[],
-- products.tags text[], product_option_groups/options em si) usa coluna
-- array direto, sem tabela de juncao — N aqui e' o numero de mesas de UMA
-- loja (tipicamente < 20), sem necessidade de ordem, filtro ou FK reversa.
-- Array simples e' a forma que já e' idiomatica nesta base pra esse tamanho
-- de problema.
--
-- `null` ou `'{}'` = sem restricao (todas as mesas) — e' o valor de TODO
-- store_user ja existente (coluna nova sem default restritivo), entao
-- nenhuma das 7 lojas reais muda de comportamento.
alter table store_users add column if not exists assigned_table_ids uuid[];

-- store_users nao tem policy de SELECT pra anon desde a migration 014 (era
-- de onde vazava senha em texto puro) — toda leitura/escrita passa por
-- functions security definer. As functions abaixo (login, restauracao de
-- sessao, gestao de usuarios) precisam devolver/aceitar assigned_table_ids
-- pra TablesView poder aplicar o enforcement no client.

-- ─── Login (garcom/caixa logando de verdade) ──────────────────────────────
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
      'assigned_table_ids', v_user.assigned_table_ids)
  );
end;
$$;

-- ─── Restauracao de sessao (F5) ────────────────────────────────────────────
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
    'assigned_table_ids', v_user.assigned_table_ids
  );
end;
$$;

-- ─── Listagem (telas de gestao de usuarios, lojista e Master Admin) ───────
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
      'assigned_table_ids', assigned_table_ids
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
      'assigned_table_ids', su.assigned_table_ids,
      'created_at', su.created_at, 'store', to_jsonb(s.*)
    ) order by su.created_at desc)
    from store_users su join stores s on s.id = su.store_id
  ), '[]'::jsonb);
end;
$$;

-- ─── Escrita (criar/editar usuario) ────────────────────────────────────────
-- Achado ao aplicar em producao: `create or replace function` com um
-- parametro NOVO (mesmo com default) nao substitui a function antiga —
-- Postgres cria uma SEGUNDA sobrecarga (overload) com o nome igual, e
-- qualquer chamada com os 6 argumentos originais passa a ser ambigua
-- ("function is not unique"). Precisa apagar a assinatura antiga (6 args)
-- antes de criar a nova (7 args) pra nao deixar duas funcoes com o mesmo
-- nome disputando a mesma chamada.
drop function if exists public.create_store_team_member_secure(uuid, text, text, text, text, jsonb);

-- p_assigned_table_ids novo, opcional (default null = sem restricao) —
-- create_store_team_member_secure ja era chamada sem esse parametro em todo
-- call site existente (createStoreUser do Master Admin, que cria 'owner' e
-- nunca precisa disso), entao o default mantem essas chamadas funcionando
-- sem mudar assinatura de quem nao usa.
create or replace function public.create_store_team_member_secure(
  p_store_id uuid, p_name text, p_email text, p_password text, p_role text, p_permissions jsonb,
  p_assigned_table_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into store_users (store_id, name, email, password, role, permissions, must_change_password, assigned_table_ids)
  values (p_store_id, p_name, p_email, p_password, p_role, p_permissions, true, p_assigned_table_ids)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('success', false, 'message', 'Este e-mail já está cadastrado nesta loja.');
end;
$$;

-- p_updates ganha uma chave nova opcional 'assigned_table_ids' — quando a
-- chave nao vem no jsonb, `coalesce` preserva o valor atual (mesmo padrao
-- ja usado pras outras colunas nesta function). Diferente de 'permissions'
-- (que so' aceita objeto, nunca null), assigned_table_ids PRECISA aceitar
-- null como valor explicito gravado (e' como "Todas as mesas" volta a
-- valer pra um usuario que antes tinha restricao) — por isso o case
-- explicito abaixo em vez de um coalesce simples, que trataria
-- `'assigned_table_ids': null` no jsonb como "chave ausente" e nunca
-- limparia a restricao.
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
    assigned_table_ids = case
      when p_updates ? 'assigned_table_ids' then (
        -- Achado ao aplicar em producao: `p_updates->'assigned_table_ids'`
        -- quando a chave existe com valor JSON `null` devolve o LITERAL
        -- jsonb `null` (nao SQL NULL) — `coalesce(..., '[]'::jsonb)` nao
        -- pega esse caso (coalesce so' substitui SQL NULL), e
        -- `jsonb_array_length('null'::jsonb)` explode com "cannot get
        -- array length of a scalar". Precisa checar `jsonb_typeof(...) =
        -- 'null'` explicitamente antes de chamar jsonb_array_length.
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

-- Grants (idempotentes) — CREATE OR REPLACE preserva a mesma pg_proc row
-- pras functions sem mudanca de assinatura (login/leitura/update); pra
-- create_store_team_member_secure (que ganhou um parametro novo com
-- default), reafirmar o grant explicito evita depender de o Postgres
-- carregar a concessao antiga pra assinatura estendida.
grant execute on function public.authenticate_store_user_secure(text, text) to anon, authenticated;
grant execute on function public.fetch_store_user_by_id_secure(uuid) to anon, authenticated;
grant execute on function public.fetch_store_team_members_secure(uuid) to anon, authenticated;
grant execute on function public.fetch_all_store_users_secure() to anon, authenticated;
grant execute on function public.create_store_team_member_secure(uuid, text, text, text, text, jsonb, uuid[]) to anon, authenticated;
grant execute on function public.update_store_user_secure(uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
