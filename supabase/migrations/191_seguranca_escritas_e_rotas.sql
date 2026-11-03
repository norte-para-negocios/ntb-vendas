-- 191: escritas de loja/categoria e fechamento de mesa por RPC com sessão (02/11/2026, Task 5 do plano melhorias-vendas).
-- TUDO ADITIVO e dormente atrás de seg_flags.exigir_sessao (migration 182): com a chave desligada as funções novas aceitam
-- qualquer chamada (como hoje). Nada é revogado aqui: allow_all_anon de stores/categories e close_table_orders_secure
-- continuam para os apps antigos (1.2.117). O corte é a Task 9 (ligar a chave + revogar antigas + trocar as policies).
-- Também muda verify_store_staff_login_secure: bloqueio por PESSOA (não mais a loja inteira).
-- Aplicar: docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < 191_seguranca_escritas_e_rotas.sql (o NOTIFY vai no fim).

-- ---------------------------------------------------------------------------------------------------------------
-- Sessão de QUALQUER pessoa da equipe da loja (não só gestor). _sessao_ok (182) exige dono/gerente/permissions.admin, o
-- que travaria caixa/garçom no fechamento de mesa e em telas de configuração liberadas por permissão. Master/universal
-- valem em qualquer loja. p_aceita_aberto = false recusa a conta "Aberto" (PC do salão, role 'open').
create or replace function public._sessao_equipe_ok(p_token text, p_loja uuid, p_aceita_aberto boolean default true) returns boolean
language plpgsql stable security definer set search_path to 'public' as $$
declare s sessoes_app%rowtype;
begin
  if not coalesce((select valor from seg_flags where chave = 'exigir_sessao'), false) then return true; end if;
  if p_token is null then return false; end if;
  select * into s from sessoes_app where token = p_token and expira_em > now();
  if not found then return false; end if;
  if s.tipo in ('admin', 'universal') then return true; end if;
  if p_loja is null then return false; end if;
  return exists (select 1 from store_users u where u.id = s.user_id and u.store_id = p_loja and (p_aceita_aberto or u.role <> 'open'));
end $$;
revoke all on function public._sessao_equipe_ok(text, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Configuração da loja (stores.config inteiro, mesmo contrato de updateStoreConfig).
create or replace function public.update_store_config_secure(p_store_id uuid, p_config jsonb, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not _sessao_equipe_ok(p_token, p_store_id, false) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then return jsonb_build_object('success', false, 'message', 'Configuração inválida.'); end if;
  update stores set config = p_config where id = p_store_id;
  if not found then return jsonb_build_object('success', false, 'message', 'Loja não encontrada.'); end if;
  return jsonb_build_object('success', true);
end $$;
grant execute on function public.update_store_config_secure(uuid, jsonb, text) to anon, authenticated;

create or replace function public.update_store_cover_secure(p_store_id uuid, p_cover_url text, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not _sessao_equipe_ok(p_token, p_store_id, false) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  if length(coalesce(p_cover_url, '')) > 2000 then return jsonb_build_object('success', false, 'message', 'Endereço da imagem grande demais.'); end if;
  update stores set cover_url = nullif(btrim(coalesce(p_cover_url, '')), '') where id = p_store_id;
  if not found then return jsonb_build_object('success', false, 'message', 'Loja não encontrada.'); end if;
  return jsonb_build_object('success', true);
end $$;
grant execute on function public.update_store_cover_secure(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Categorias.
create or replace function public.create_category_secure(p_store_id uuid, p_name text, p_group_id uuid default null, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_ordem int;
begin
  if not _sessao_equipe_ok(p_token, p_store_id, false) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  if length(btrim(coalesce(p_name, ''))) = 0 or length(p_name) > 120 then return jsonb_build_object('success', false, 'message', 'Coloque o nome da categoria.'); end if;
  if not exists (select 1 from stores where id = p_store_id) then return jsonb_build_object('success', false, 'message', 'Loja não encontrada.'); end if;
  if p_group_id is not null and not exists (select 1 from category_groups where id = p_group_id and store_id = p_store_id) then
    return jsonb_build_object('success', false, 'message', 'Grupo não encontrado nesta loja.');
  end if;
  select coalesce(max("order"), 0) + 1 into v_ordem from categories where store_id = p_store_id;
  insert into categories (store_id, name, "order", group_id) values (p_store_id, p_name, v_ordem, p_group_id) returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
end $$;
grant execute on function public.create_category_secure(uuid, text, uuid, text) to anon, authenticated;

create or replace function public.delete_category_secure(p_category_id uuid, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_store uuid;
begin
  select store_id into v_store from categories where id = p_category_id;
  if not found then return jsonb_build_object('success', true); end if; -- já apagada: mesmo resultado do delete direto
  if not _sessao_equipe_ok(p_token, v_store, false) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  delete from categories where id = p_category_id;
  return jsonb_build_object('success', true);
end $$;
grant execute on function public.delete_category_secure(uuid, text) to anon, authenticated;

-- Só os campos que a tela muda por categoria: horário (018), grupo (079), local de preparo (087).
-- Chave ausente = não mexe; chave com null = limpa.
create or replace function public.update_category_fields_secure(p_category_id uuid, p_fields jsonb, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_store uuid; v_group uuid; v_sector uuid; v_dias int[];
begin
  select store_id into v_store from categories where id = p_category_id;
  if not found then return jsonb_build_object('success', false, 'message', 'Categoria não encontrada.'); end if;
  if not _sessao_equipe_ok(p_token, v_store, false) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then return jsonb_build_object('success', false, 'message', 'Dados inválidos.'); end if;

  if p_fields ? 'group_id' and jsonb_typeof(p_fields->'group_id') <> 'null' then
    v_group := (p_fields->>'group_id')::uuid;
    if not exists (select 1 from category_groups where id = v_group and store_id = v_store) then
      return jsonb_build_object('success', false, 'message', 'Grupo não encontrado nesta loja.');
    end if;
  end if;
  if p_fields ? 'sector_id' and jsonb_typeof(p_fields->'sector_id') <> 'null' then
    v_sector := (p_fields->>'sector_id')::uuid;
    if not exists (select 1 from print_sectors where id = v_sector and store_id = v_store) then
      return jsonb_build_object('success', false, 'message', 'Local de preparo não encontrado nesta loja.');
    end if;
  end if;
  if p_fields ? 'available_days' and jsonb_typeof(p_fields->'available_days') = 'array' then
    select array_agg(x::int) into v_dias from jsonb_array_elements_text(p_fields->'available_days') x;
    if exists (select 1 from unnest(coalesce(v_dias, '{}'::int[])) d where d < 0 or d > 6) then
      return jsonb_build_object('success', false, 'message', 'Dia da semana inválido.');
    end if;
  end if;

  update categories set
    available_from = case when p_fields ? 'available_from' then nullif(p_fields->>'available_from', '')::time else available_from end,
    available_until = case when p_fields ? 'available_until' then nullif(p_fields->>'available_until', '')::time else available_until end,
    available_days = case when p_fields ? 'available_days' then v_dias else available_days end,
    group_id = case when p_fields ? 'group_id' then v_group else group_id end,
    sector_id = case when p_fields ? 'sector_id' then v_sector else sector_id end
  where id = p_category_id;
  return jsonb_build_object('success', true);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  return jsonb_build_object('success', false, 'message', 'Dados inválidos.');
end $$;
grant execute on function public.update_category_fields_secure(uuid, jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Lojas (Master Admin). _sessao_ok(token, null) = só Master/universal quando a chave está ligada.
-- p_fields: as colunas que createStore/updateStore já gravavam (name, cnpj, slug, contract_type, contract_period_months,
-- is_active, logo_url, cover_url, stock_mode, config). Chave ausente = não mexe (update) / default da coluna (insert).
create or replace function public.create_store_secure(p_fields jsonb, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not _sessao_ok(p_token, null) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then return jsonb_build_object('success', false, 'message', 'Dados inválidos.'); end if;
  if length(btrim(coalesce(p_fields->>'name', ''))) = 0 or length(btrim(coalesce(p_fields->>'slug', ''))) = 0 then
    return jsonb_build_object('success', false, 'message', 'Nome e endereço (slug) são obrigatórios.');
  end if;
  insert into stores (name, cnpj, slug, contract_type, contract_period_months, is_active, logo_url, cover_url, stock_mode, config)
  values (
    p_fields->>'name',
    p_fields->>'cnpj',
    p_fields->>'slug',
    coalesce(p_fields->>'contract_type', 'balcao'),
    case when p_fields ? 'contract_period_months' then (p_fields->>'contract_period_months')::int else 12 end,
    coalesce((p_fields->>'is_active')::boolean, true),
    p_fields->>'logo_url',
    p_fields->>'cover_url',
    coalesce(p_fields->>'stock_mode', 'omie'),
    case when jsonb_typeof(p_fields->'config') = 'object' then p_fields->'config' else '{"use_pin": true, "allow_client_open": true}'::jsonb end
  ) returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
exception
  when unique_violation then return jsonb_build_object('success', false, 'code', 'slug', 'message', 'Este slug (URL) já está em uso.');
  when check_violation or invalid_text_representation then return jsonb_build_object('success', false, 'message', 'Dados da loja inválidos.');
end $$;
grant execute on function public.create_store_secure(jsonb, text) to anon, authenticated;

create or replace function public.update_store_secure(p_store_id uuid, p_fields jsonb, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not _sessao_ok(p_token, null) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then return jsonb_build_object('success', false, 'message', 'Dados inválidos.'); end if;
  update stores set
    name = case when p_fields ? 'name' then p_fields->>'name' else name end,
    cnpj = case when p_fields ? 'cnpj' then p_fields->>'cnpj' else cnpj end,
    slug = case when p_fields ? 'slug' then p_fields->>'slug' else slug end,
    contract_type = case when p_fields ? 'contract_type' then p_fields->>'contract_type' else contract_type end,
    contract_period_months = case when p_fields ? 'contract_period_months' then (p_fields->>'contract_period_months')::int else contract_period_months end,
    is_active = case when p_fields ? 'is_active' then coalesce((p_fields->>'is_active')::boolean, is_active) else is_active end,
    logo_url = case when p_fields ? 'logo_url' then p_fields->>'logo_url' else logo_url end,
    cover_url = case when p_fields ? 'cover_url' then p_fields->>'cover_url' else cover_url end,
    stock_mode = case when p_fields ? 'stock_mode' then p_fields->>'stock_mode' else stock_mode end,
    config = case when jsonb_typeof(p_fields->'config') = 'object' then p_fields->'config' else config end
  where id = p_store_id;
  if not found then return jsonb_build_object('success', false, 'message', 'Loja não encontrada.'); end if;
  return jsonb_build_object('success', true);
exception
  when unique_violation then return jsonb_build_object('success', false, 'code', 'slug', 'message', 'Este slug (URL) já está em uso por outra loja.');
  when check_violation or not_null_violation or invalid_text_representation then return jsonb_build_object('success', false, 'message', 'Dados da loja inválidos.');
end $$;
grant execute on function public.update_store_secure(uuid, jsonb, text) to anon, authenticated;

-- "Excluir loja" continua soft-delete.
create or replace function public.delete_store_secure(p_store_id uuid, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not _sessao_ok(p_token, null) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  update stores set is_active = false where id = p_store_id;
  return jsonb_build_object('success', true);
end $$;
grant execute on function public.delete_store_secure(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Fechamento de mesa com conferência (substitui close_table_orders_secure, que fica para os apps antigos até a Task 9).
-- Diferenças: confere a sessão; fecha só os pedidos ABERTOS da mesa e só os itens DELES (a antiga regravava 'delivered'
-- em todo item histórico da mesa); recusa quando o pago é menor que os itens não cancelados (- R$ 0,01), exceto cortesia.
-- A conta pode ter taxa a mais (10%), então o valor devido do servidor é só a soma dos itens.
create or replace function public.close_table_orders_v2(
  p_table_id uuid,
  p_payment_method text default null,
  p_payment_details jsonb default null,
  p_operator_user_id uuid default null,
  p_token text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_store uuid;
  v_ids uuid[];
  v_devido numeric;
  v_total numeric;
  v_soma numeric;
  v_metodos jsonb;
  v_det jsonb := p_payment_details;
begin
  select store_id into v_store from tables where id = p_table_id;
  if not found then return jsonb_build_object('success', false, 'code', 'mesa', 'message', 'Mesa não encontrada.'); end if;
  if not _sessao_equipe_ok(p_token, v_store, true) then
    return jsonb_build_object('success', false, 'code', 'sessao', 'message', 'Sessão vencida. Saia e entre de novo.');
  end if;
  perform 1 from tables where id = p_table_id for update; -- dois caixas fechando a mesma mesa: um espera o outro

  select array_agg(id) into v_ids from orders
   where table_id = p_table_id and store_id = v_store and status not in ('delivered', 'canceled');
  if v_ids is null then return jsonb_build_object('success', true, 'fechados', 0); end if;

  select coalesce(round(sum(quantity * price_at_time)::numeric, 2), 0) into v_devido
    from order_items where order_id = any(v_ids) and status <> 'canceled';

  if v_det is null or jsonb_typeof(v_det) = 'null' then
    v_det := null;
    if v_devido > 0.01 then
      return jsonb_build_object('success', false, 'code', 'valor', 'message', 'Informe o pagamento antes de fechar a mesa.');
    end if;
  elsif jsonb_typeof(v_det) <> 'object' then
    return jsonb_build_object('success', false, 'code', 'pagamento', 'message', 'Pagamento inválido.');
  else
    v_metodos := case when jsonb_typeof(v_det->'methods') = 'array' then v_det->'methods' else '[]'::jsonb end;
    if not exists (select 1 from jsonb_array_elements(v_metodos) m where m->>'method' = 'COURTESY') then
      v_total := case when jsonb_typeof(v_det->'total') = 'number' then (v_det->>'total')::numeric end;
      select coalesce(sum(case when jsonb_typeof(m->'amount') = 'number' then (m->>'amount')::numeric else 0 end), 0)
        into v_soma from jsonb_array_elements(v_metodos) m;
      if v_total is null or v_total < v_devido - 0.01 or v_soma < v_devido - 0.01 then
        return jsonb_build_object('success', false, 'code', 'valor', 'devido', v_devido,
          'message', 'O valor pago é menor que o total da mesa (R$ ' || replace(to_char(v_devido, 'FM999999990.00'), '.', ',') || '). Confira a conta e receba de novo.');
      end if;
    end if;
    -- quem recebeu (só se for da loja; nunca sobrescreve o que o app já mandou)
    if p_operator_user_id is not null and not (v_det ? 'operador_id')
       and exists (select 1 from store_users where id = p_operator_user_id and store_id = v_store) then
      v_det := v_det || jsonb_build_object('operador_id', p_operator_user_id);
    end if;
  end if;

  update orders set
    status = 'delivered',
    payment_method = coalesce(p_payment_method, payment_method),
    payment_details = coalesce(v_det, payment_details),
    updated_at = now()
  where id = any(v_ids);

  update order_items set status = 'delivered'
   where order_id = any(v_ids) and status <> 'canceled';

  return jsonb_build_object('success', true, 'fechados', array_length(v_ids, 1));
end $$;
grant execute on function public.close_table_orders_v2(uuid, text, jsonb, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- "Toque no seu nome" + senha (166/180): bloqueio por PESSOA, não pela loja inteira. Antes 10 erros de qualquer um
-- travavam o login de todo mundo da loja por 1 min (e quem errasse de propósito travava o salão). Agora cada pessoa:
-- a cada 10 erros seguidos, trava 1 min, 2 min, 3 min... até 15 min. Acertar zera. Mesmo retorno de antes.
-- Usa store_users.login_attempts/login_locked_until (008), as mesmas do login por e-mail: a senha é a mesma.
create or replace function public.verify_store_staff_login_secure(p_store_id uuid, p_user_id uuid, p_password text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_u store_users%rowtype;
  v_tentativas int;
begin
  if p_store_id is null or p_user_id is null or coalesce(p_password, '') = '' then
    return jsonb_build_object('success', false, 'error', 'invalid');
  end if;

  select * into v_u from store_users where id = p_user_id and store_id = p_store_id for update;
  if not found or v_u.role = 'open' then
    return jsonb_build_object('success', false, 'error', 'invalid');
  end if;

  if v_u.login_locked_until is not null and v_u.login_locked_until > now() then
    return jsonb_build_object('success', false, 'error', 'locked', 'seconds', ceil(extract(epoch from v_u.login_locked_until - now())));
  end if;

  if v_u.password = p_password then
    update store_users set login_attempts = 0, login_locked_until = null where id = v_u.id;
    return jsonb_build_object('success', true, 'user_id', v_u.id, 'name', v_u.name, 'role', v_u.role);
  end if;

  v_tentativas := coalesce(v_u.login_attempts, 0) + 1;
  update store_users set
    login_attempts = v_tentativas,
    login_locked_until = case when v_tentativas % 10 = 0
      then now() + make_interval(mins => least(15, v_tentativas / 10)) else login_locked_until end
  where id = v_u.id;
  return jsonb_build_object('success', false, 'error', 'invalid');
end;
$function$;

notify pgrst, 'reload schema';
