-- 164 — correções da revisão independente da 163 (06/10/2026).
--  * triggers não auditam efeito em cascata nem operação em massa (evita milhares de subtransações e lentidão);
--  * zerar histórico grava UMA linha-resumo;
--  * limpeza de segredos/PII recursiva e arrays grandes cortados;
--  * log_staff_action_secure: lista de ações permitidas, limite por minuto, id do cliente (sem duplicar reenvio da fila).

alter table public.staff_audit_log add column if not exists client_id uuid;
create unique index if not exists staff_audit_log_client_id on public.staff_audit_log (client_id) where client_id is not null;

create or replace function public.ntb_audit_limpar(j jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; v jsonb; r jsonb; i int;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'object' then
    r := '{}'::jsonb;
    for k, v in select * from jsonb_each(j) loop
      if k ~* '(password|senha|^pass$|token|secret|content|xml|payload|^pdf|cpf|cnpj|documento|pessoa_identificador)' then continue; end if;
      r := r || jsonb_build_object(k, public.ntb_audit_limpar(v));
    end loop;
    return r;
  elsif jsonb_typeof(j) = 'array' then
    if jsonb_array_length(j) > 20 then return to_jsonb('lista com ' || jsonb_array_length(j) || ' itens'); end if;
    r := '[]'::jsonb;
    for i in 0 .. jsonb_array_length(j) - 1 loop r := r || jsonb_build_array(public.ntb_audit_limpar(j -> i)); end loop;
    return r;
  elsif jsonb_typeof(j) = 'string' and length(j #>> '{}') > 300 then
    return to_jsonb(left(j #>> '{}', 300) || '…');
  end if;
  return j;
end $$;

create or replace function public.ntb_audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; base jsonb; ch jsonb := '{}'::jsonb; k text;
  a jsonb; v_store uuid; ctx jsonb := '{}'::jsonb;
  ruido text[] := array['updated_at','login_attempts','login_locked_until','pin_attempts','pin_locked_until','last_login_at','last_seen_at'];
begin
  -- operação em massa (zerar histórico) ou efeito em cascata de outra mudança: não audita linha a linha
  if coalesce(current_setting('ntb.audit_skip', true), '') = '1' or pg_trigger_depth() > 1 then return null; end if;
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

    for k in select unnest(array['table_id','order_id','product_id','shift_id','order_type','status']) loop
      if base ? k and base ->> k is not null then ctx := ctx || jsonb_build_object(k, base -> k); end if;
    end loop;

    a := public.ntb_actor();
    insert into staff_audit_log (store_id, actor_user_id, actor_name, actor_role, action, entity, entity_id, summary, details, origin)
    values (
      v_store, a ->> 'id', coalesce(a ->> 'name', '(sem login)'), a ->> 'role',
      TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, base ->> 'id', null,
      jsonb_build_object('ctx', ctx) || case when TG_OP = 'UPDATE' then jsonb_build_object('mudou', public.ntb_audit_limpar(ch))
                                             else jsonb_build_object('linha', public.ntb_audit_limpar(base)) end,
      'trigger'
    );
  exception when others then
    null; -- auditoria nunca derruba a venda
  end;
  return null;
end $$;

create or replace function public.clear_sales_history_secure(p_store_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n int; a jsonb;
begin
  perform set_config('ntb.audit_skip', '1', true);
  select count(*) into n from orders where store_id = p_store_id;
  delete from orders where store_id = p_store_id;
  perform set_config('ntb.audit_skip', '', true);
  a := public.ntb_actor();
  insert into staff_audit_log (store_id, actor_user_id, actor_name, actor_role, action, entity, summary, details, origin)
  values (p_store_id, a ->> 'id', coalesce(a ->> 'name', '(sem login)'), a ->> 'role', 'historico.zerar', 'orders',
          'ZEROU o histórico de vendas: ' || n || ' pedidos apagados', jsonb_build_object('pedidos_apagados', n), 'server');
end $$;

drop function if exists public.log_staff_action_secure(uuid, text, text, text, text, jsonb, timestamptz, jsonb);
create or replace function public.log_staff_action_secure(
  p_store_id uuid, p_action text, p_entity text default null, p_entity_id text default null,
  p_summary text default null, p_details jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null, p_actor jsonb default null, p_client_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  if p_action is null or length(p_action) > 80 or p_action !~ '^(login|reimpressao|historico|fiscal|impressao|suporte|sessao|mesa|pedido|caixa)\.[a-z_]+$' then return; end if;
  if p_store_id is not null and not exists (select 1 from stores where id = p_store_id) then return; end if;
  if p_store_id is not null and (select count(*) from staff_audit_log where store_id = p_store_id and origin = 'app' and occurred_at > now() - interval '1 minute') > 300 then return; end if;
  if length(coalesce(p_details, '{}'::jsonb)::text) > 20000 then p_details := '{"cortado":true}'::jsonb; end if;
  a := coalesce(p_actor, public.ntb_actor());
  insert into staff_audit_log (store_id, occurred_at, actor_user_id, actor_name, actor_role, action, entity, entity_id, summary, details, origin, client_id)
  values (p_store_id, least(coalesce(p_occurred_at, now()), now()), a ->> 'id', coalesce(a ->> 'name', '(sem login)'), a ->> 'role',
          p_action, left(p_entity, 80), left(p_entity_id, 120), left(p_summary, 500), public.ntb_audit_limpar(coalesce(p_details, '{}'::jsonb)), 'app', p_client_id)
  on conflict (client_id) where client_id is not null do nothing;
exception when others then null;
end $$;
grant execute on function public.log_staff_action_secure(uuid, text, text, text, text, jsonb, timestamptz, jsonb, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
