-- 163 — Auditoria completa de funcionários (06/10/2026). Aditiva: tabela nova + triggers AFTER que nunca derrubam a operação.
-- Ator: o app manda o cabeçalho X-NTB-Actor (base64 de {"id","name","role"}); o PostgREST o entrega em request.headers.
-- Sem sessão no servidor, o ator vem do cliente (limite conhecido, documentado no relatório).

create table if not exists public.staff_audit_log (
  id            bigint generated always as identity primary key,
  store_id      uuid,
  occurred_at   timestamptz not null default now(),
  actor_user_id text,
  actor_name    text,
  actor_role    text,
  action        text not null,
  entity        text,
  entity_id     text,
  summary       text,
  details       jsonb not null default '{}'::jsonb,
  origin        text not null default 'trigger'
);
create index if not exists staff_audit_log_loja_data on public.staff_audit_log (store_id, occurred_at desc);
create index if not exists staff_audit_log_ator_data on public.staff_audit_log (store_id, actor_user_id, occurred_at desc);

alter table public.staff_audit_log enable row level security;  -- sem policy: ninguém lê direto, só pelas funções abaixo
revoke all on public.staff_audit_log from anon, authenticated;

-- Ator da requisição atual (null = sem login / chamada de servidor).
create or replace function public.ntb_actor() returns jsonb
language plpgsql stable set search_path = public as $$
declare h text; v text;
begin
  begin h := nullif(current_setting('request.headers', true), ''); exception when others then return null; end;
  if h is null then return null; end if;
  v := (h::jsonb)->>'x-ntb-actor';
  if v is null or v = '' then return null; end if;
  return convert_from(decode(v, 'base64'), 'UTF8')::jsonb;
exception when others then return null;
end $$;

-- Remove segredos e textos enormes antes de gravar.
create or replace function public.ntb_audit_limpar(j jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; v jsonb; r jsonb := '{}'::jsonb;
begin
  if j is null then return null; end if;
  for k, v in select * from jsonb_each(j) loop
    if k ~* '(password|senha|^pass$|token|secret|content|xml|payload|^pdf)' then continue; end if;
    if jsonb_typeof(v) = 'string' and length(v #>> '{}') > 300 then v := to_jsonb(left(v #>> '{}', 300) || '…'); end if;
    if jsonb_typeof(v) = 'object' and length(v::text) > 1500 then v := to_jsonb(left(v::text, 1500) || '…'); end if;
    r := r || jsonb_build_object(k, v);
  end loop;
  return r;
end $$;

create or replace function public.ntb_audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; base jsonb; ch jsonb := '{}'::jsonb; k text;
  a jsonb; v_store uuid; ctx jsonb := '{}'::jsonb;
  ruido text[] := array['updated_at','login_attempts','login_locked_until','pin_attempts','pin_locked_until','last_login_at','last_seen_at'];
begin
  begin
    if TG_OP = 'INSERT' then n := to_jsonb(NEW); base := n;
    elsif TG_OP = 'DELETE' then o := to_jsonb(OLD); base := o;
    else
      o := to_jsonb(OLD); n := to_jsonb(NEW); base := n;
      for k in select jsonb_object_keys(n) loop
        if not (k = any(ruido)) and (o -> k) is distinct from (n -> k) then
          ch := ch || jsonb_build_object(k, jsonb_build_object('de', o -> k, 'para', n -> k));
        end if;
      end loop;
      if ch = '{}'::jsonb then return null; end if;
    end if;

    v_store := nullif(coalesce(base ->> 'store_id', case when TG_TABLE_NAME = 'stores' then base ->> 'id' end), '')::uuid;
    if v_store is null then
      if TG_TABLE_NAME = 'cash_movements' then
        select store_id into v_store from cash_shifts where id = (base ->> 'shift_id')::uuid;
      elsif TG_TABLE_NAME in ('product_option_groups', 'product_recommendations') then
        select store_id into v_store from products where id = (base ->> 'product_id')::uuid;
      elsif TG_TABLE_NAME = 'product_options' then
        select p.store_id into v_store from product_option_groups g join products p on p.id = g.product_id where g.id = (base ->> 'group_id')::uuid;
      end if;
    end if;

    -- contexto sempre presente (mesmo quando só mudam poucas colunas)
    for k in select unnest(array['table_id','order_id','product_id','shift_id','order_type','status']) loop
      if base ? k and base ->> k is not null then ctx := ctx || jsonb_build_object(k, base -> k); end if;
    end loop;

    a := public.ntb_actor();
    insert into staff_audit_log (store_id, actor_user_id, actor_name, actor_role, action, entity, entity_id, summary, details, origin)
    values (
      v_store, a ->> 'id', coalesce(a ->> 'name', '(sem login)'), a ->> 'role',
      TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, base ->> 'id',
      null,
      jsonb_build_object('ctx', ctx) || case when TG_OP = 'UPDATE' then jsonb_build_object('mudou', public.ntb_audit_limpar(ch))
                                             else jsonb_build_object('linha', public.ntb_audit_limpar(base)) end,
      'trigger'
    );
  exception when others then
    null; -- auditoria nunca derruba a venda
  end;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'orders','order_items','tables','table_sessions','products','categories','category_groups',
    'product_option_groups','product_options','product_recommendations','store_users','stores',
    'printer_configs','print_sectors','discount_coupons','price_schedules','fiscal_notas',
    'cash_shifts','cash_movements','table_reservations','store_fiscal_config','operator_checkins'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists ntb_audit_%1$s on public.%1$I', t);
      execute format('create trigger ntb_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.ntb_audit_trigger()', t);
    end if;
  end loop;
end $$;

-- print_jobs: só INSERT (quem mandou imprimir/reimprimir); status do agente de impressão não interessa.
drop trigger if exists ntb_audit_print_jobs on public.print_jobs;
create trigger ntb_audit_print_jobs after insert on public.print_jobs for each row execute function public.ntb_audit_trigger();

-- Ações que não mudam linha (login, logout, reimpressão, exportação...), gravadas pelo app.
create or replace function public.log_staff_action_secure(
  p_store_id uuid, p_action text, p_entity text default null, p_entity_id text default null,
  p_summary text default null, p_details jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null, p_actor jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  if p_action is null or length(p_action) > 80 then return; end if;
  if p_store_id is not null and not exists (select 1 from stores where id = p_store_id) then return; end if;
  if length(coalesce(p_details, '{}'::jsonb)::text) > 20000 then p_details := '{"cortado":true}'::jsonb; end if;
  a := coalesce(p_actor, public.ntb_actor());
  insert into staff_audit_log (store_id, occurred_at, actor_user_id, actor_name, actor_role, action, entity, entity_id, summary, details, origin)
  values (p_store_id, least(coalesce(p_occurred_at, now()), now()), a ->> 'id', coalesce(a ->> 'name', '(sem login)'), a ->> 'role',
          p_action, left(p_entity, 80), left(p_entity_id, 120), left(p_summary, 500), coalesce(p_details, '{}'::jsonb), 'app');
exception when others then null;
end $$;

-- Leitura (tela do gerente). Só quem pode ver exceções.
create or replace function public.fetch_staff_audit_secure(
  p_store_id uuid, p_user_id uuid, p_from timestamptz, p_to timestamptz, p_actor_id text default null, p_limit int default 500
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.operator_can_secure(p_store_id, p_user_id, 'ver_excecoes') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.occurred_at desc) from (
      select id, occurred_at, actor_user_id, actor_name, actor_role, action, entity, entity_id, summary, details, origin
      from staff_audit_log
      where store_id = p_store_id and occurred_at >= p_from and occurred_at < p_to
        and (p_actor_id is null or actor_user_id = p_actor_id)
      order by occurred_at desc limit least(coalesce(p_limit, 500), 2000)
    ) x), '[]'::jsonb);
end $$;

grant execute on function public.log_staff_action_secure(uuid, text, text, text, text, jsonb, timestamptz, jsonb) to anon, authenticated;
grant execute on function public.fetch_staff_audit_secure(uuid, uuid, timestamptz, timestamptz, text, int) to anon, authenticated;

notify pgrst, 'reload schema';
