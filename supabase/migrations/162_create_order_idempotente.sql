-- 162: pedido idempotente. Aditiva: create_order_secure não muda (apps 1.2.83-1.2.87 e 1.0.19-1.0.23 seguem usando ela).
-- Cada pedido do app novo leva um client_request_id; o mesmo id enviado de novo (reenvio da fila offline depois de a resposta
-- se perder) devolve a resposta guardada em vez de criar outro pedido.
begin;

create table if not exists public.order_requests (
  client_request_id uuid primary key,
  store_id uuid not null,
  order_id uuid,
  response jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists order_requests_created_at_idx on public.order_requests (created_at);
alter table public.order_requests enable row level security;
-- sem policy nenhuma: só as funções security definer abaixo leem/gravam.

create or replace function public.create_order_v3(
  p_table_id uuid, p_store_id uuid, p_order_type text, p_customer_name text,
  p_items jsonb, p_added_by_role text, p_added_by_name text, p_client_request_id uuid
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_prev jsonb;
  v_res jsonb;
begin
  if p_client_request_id is null then
    return create_order_secure(p_table_id, p_store_id, p_order_type, p_customer_name, p_items, p_added_by_role, p_added_by_name);
  end if;

  -- serializa tentativas com o mesmo id (reenvio simultâneo)
  perform pg_advisory_xact_lock(hashtextextended(p_client_request_id::text, 0));

  select response into v_prev from order_requests
   where client_request_id = p_client_request_id and store_id = p_store_id;
  if v_prev is not null then
    return v_prev || jsonb_build_object('duplicado', true);
  end if;

  v_res := create_order_secure(p_table_id, p_store_id, p_order_type, p_customer_name, p_items, p_added_by_role, p_added_by_name);

  if coalesce((v_res->>'success')::boolean, false) then
    insert into order_requests (client_request_id, store_id, order_id, response)
    values (p_client_request_id, p_store_id, nullif(v_res->>'order_id', '')::uuid, v_res)
    on conflict (client_request_id) do nothing;
  end if;

  -- limpeza barata: no máximo 50 linhas com mais de 14 dias por chamada
  delete from order_requests where ctid in (
    select ctid from order_requests where created_at < now() - interval '14 days' limit 50);

  return v_res;
end;
$$;

grant execute on function public.create_order_v3(uuid, uuid, text, text, jsonb, text, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
