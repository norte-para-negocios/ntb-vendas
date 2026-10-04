-- 156: outbox da baixa de estoque Vendas -> Estoque (04/10/2026, auditoria de integração, achado B1).
-- Antes: o navegador disparava a baixa sem fila nem retry; se o app fechava, a rede caía ou o Estoque falhava, a
-- baixa sumia em silêncio. Agora cada pedido vira UMA linha aqui ANTES de chamar o Estoque; o resultado é gravado
-- POR ITEM (resultado jsonb) e o job do servidor (instrumentation.ts) reenvia só o que está comprovadamente não
-- gravado. 100% ADITIVA: só tabelas e funções novas, nenhuma função/tabela existente é alterada.
-- Tabela fechada (RLS ligada, sem policy, sem grant): só funções security definer mexem nela.

create table if not exists public.integracao_baixas (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  rotulo text,                                   -- "Mesa 12" / "Balcão · Ana" (para a lista)
  status text not null default 'pending' check (status in ('pending', 'ok', 'parcial', 'erro', 'incerto')),
  tentativas integer not null default 0,         -- tentativas automáticas já feitas (zera quando o gerente reabre)
  ultimo_erro text,
  payload jsonb not null default '{}'::jsonb,    -- { itens: [...], pedidoRef, ambiente } exatamente como vai ao Estoque
  resultado jsonb not null default '[]'::jsonb,  -- por item (mesma ordem de payload.itens): { status, retentavel, erro... }
  enviando jsonb not null default '[]'::jsonb,   -- índices em voo agora (se o servidor cair, viram 'incerto')
  proxima_tentativa timestamptz not null default now(),
  iniciada_em timestamptz,
  em_processamento_ate timestamptz,              -- trava simples: ninguém pega a linha enquanto isto estiver no futuro
  resolvido_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integracao_baixas_uma_por_pedido unique (order_id)
);
create index if not exists idx_integracao_baixas_loja_status on public.integracao_baixas (store_id, status);
create index if not exists idx_integracao_baixas_fila on public.integracao_baixas (status, proxima_tentativa);
alter table public.integracao_baixas enable row level security;
revoke all on public.integracao_baixas from anon, authenticated;

-- Marco da varredura: só pedidos fechados DEPOIS dele entram na varredura do servidor (o que ficou para trás antes
-- do outbox existir NÃO é reprocessado sozinho: decisão do dono, ex.: as mesas antigas do Sertão).
create table if not exists public.integracao_baixas_marco (
  id integer primary key default 1 check (id = 1),
  desde timestamptz not null default now()
);
alter table public.integracao_baixas_marco enable row level security;
revoke all on public.integracao_baixas_marco from anon, authenticated;
insert into public.integracao_baixas_marco (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------- funções do servidor (só service_role)

-- Registra o pedido de baixa ANTES de chamar o Estoque. Idempotente por pedido: se já existe, devolve a existente.
create or replace function public.registrar_integracao_baixa_secure(p_store_id uuid, p_order_id uuid, p_rotulo text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row integracao_baixas;
begin
  if not exists (select 1 from orders where id = p_order_id and store_id = p_store_id) then
    raise exception 'Pedido não encontrado nesta loja.';
  end if;
  insert into integracao_baixas (store_id, order_id, rotulo, payload)
  values (p_store_id, p_order_id, p_rotulo, coalesce(p_payload, '{}'::jsonb))
  on conflict (order_id) do nothing
  returning * into v_row;
  if v_row.id is not null then
    return jsonb_build_object('id', v_row.id, 'criada', true, 'status', v_row.status);
  end if;
  select * into v_row from integracao_baixas where order_id = p_order_id;
  return jsonb_build_object('id', v_row.id, 'criada', false, 'status', v_row.status);
end;
$$;

-- Pega a linha para processar (trava de 5 min) e guarda quais itens vão em voo. Devolve a linha, ou null se
-- outro processo já está com ela / ela não está em estado de envio.
create or replace function public.iniciar_integracao_baixa_secure(p_id uuid, p_enviando jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row integracao_baixas;
begin
  update integracao_baixas
     set em_processamento_ate = now() + interval '5 minutes',
         iniciada_em = now(),
         enviando = coalesce(p_enviando, '[]'::jsonb),
         status = 'pending',
         updated_at = now()
   where id = p_id
     and (em_processamento_ate is null or em_processamento_ate < now())
     and status in ('erro', 'parcial', 'pending')
  returning * into v_row;
  if v_row.id is null then return null; end if;
  return to_jsonb(v_row);
end;
$$;

-- Grava o resultado de um envio e solta a trava.
create or replace function public.salvar_resultado_integracao_baixa_secure(
  p_id uuid, p_status text, p_resultado jsonb, p_erro text, p_proxima timestamptz, p_incrementa boolean, p_zerar boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('pending', 'ok', 'parcial', 'erro', 'incerto') then raise exception 'Status inválido.'; end if;
  update integracao_baixas
     set status = p_status,
         resultado = coalesce(p_resultado, '[]'::jsonb),
         ultimo_erro = p_erro,
         tentativas = case when p_zerar then (case when p_incrementa then 1 else 0 end) else tentativas + (case when p_incrementa then 1 else 0 end) end,
         proxima_tentativa = coalesce(p_proxima, now()),
         enviando = '[]'::jsonb,
         em_processamento_ate = null,
         resolvido_em = case when p_status = 'ok' then now() else null end,
         updated_at = now()
   where id = p_id;
end;
$$;

-- Linhas prontas para o job: nunca iniciadas (servidor caiu antes de enviar) ou com erro comprovado e já na hora.
-- p_store_id (opcional) restringe a uma loja: usado para testar o job sem tocar nas demais lojas.
create or replace function public.listar_integracao_baixas_prontas_secure(p_limite integer, p_max_tentativas integer, p_store_id uuid default null)
returns setof jsonb language sql security definer set search_path = public as $$
  select to_jsonb(b) from integracao_baixas b
   where (p_store_id is null or b.store_id = p_store_id)
     and (b.em_processamento_ate is null or b.em_processamento_ate < now())
     and (
       (b.status = 'pending' and b.iniciada_em is null and b.created_at < now() - interval '1 minute')
       or (b.status in ('erro', 'parcial') and b.proxima_tentativa <= now() and b.tentativas < p_max_tentativas)
     )
   order by b.proxima_tentativa
   limit greatest(1, least(coalesce(p_limite, 20), 100));
$$;

-- Linhas que ficaram "em voo" quando o servidor caiu (trava vencida): viram incerto.
create or replace function public.listar_integracao_baixas_interrompidas_secure(p_store_id uuid default null)
returns setof jsonb language sql security definer set search_path = public as $$
  select to_jsonb(b) from integracao_baixas b
   where (p_store_id is null or b.store_id = p_store_id)
     and b.status = 'pending' and b.iniciada_em is not null
     and b.em_processamento_ate is not null and b.em_processamento_ate < now()
   limit 50;
$$;

-- Varredura: pedidos entregues depois do marco, com a integração ligada, sem linha no outbox e sem baixa enviada.
-- Cobre o navegador que fechou/perdeu rede antes de disparar a baixa.
create or replace function public.listar_pedidos_sem_baixa_secure(p_limite integer, p_store_id uuid default null)
returns table (order_id uuid, store_id uuid) language sql security definer set search_path = public as $$
  select o.id, o.store_id
    from orders o
    join store_ntb_estoque_secrets s on s.store_id = o.store_id and s.ativo
   where (p_store_id is null or o.store_id = p_store_id)
     and o.status = 'delivered'
     and o.updated_at >= (select desde from integracao_baixas_marco where id = 1)
     and o.updated_at < now() - interval '3 minutes'
     and o.updated_at > now() - interval '48 hours'
     and coalesce(o.total, 0) > 0
     and (o.payment_details ->> 'op_enviada_em') is null
     and not (jsonb_typeof(o.payment_details -> 'total') = 'number' and (o.payment_details ->> 'total')::numeric <= 0)
     and not exists (select 1 from integracao_baixas b where b.order_id = o.id)
   order by o.updated_at
   limit greatest(1, least(coalesce(p_limite, 20), 100));
$$;

revoke execute on function public.registrar_integracao_baixa_secure(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.iniciar_integracao_baixa_secure(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.salvar_resultado_integracao_baixa_secure(uuid, text, jsonb, text, timestamptz, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.listar_integracao_baixas_prontas_secure(integer, integer, uuid) from public, anon, authenticated;
revoke execute on function public.listar_integracao_baixas_interrompidas_secure(uuid) from public, anon, authenticated;
revoke execute on function public.listar_pedidos_sem_baixa_secure(integer, uuid) from public, anon, authenticated;
grant execute on function public.registrar_integracao_baixa_secure(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.iniciar_integracao_baixa_secure(uuid, jsonb) to service_role;
grant execute on function public.salvar_resultado_integracao_baixa_secure(uuid, text, jsonb, text, timestamptz, boolean, boolean) to service_role;
grant execute on function public.listar_integracao_baixas_prontas_secure(integer, integer, uuid) to service_role;
grant execute on function public.listar_integracao_baixas_interrompidas_secure(uuid) to service_role;
grant execute on function public.listar_pedidos_sem_baixa_secure(integer, uuid) to service_role;

-- ---------------------------------------------------------------- leitura para a tela (anon/authenticated, como as demais RPCs)

-- Contadores + lista das baixas que precisam de atenção (não-ok) da loja. Não devolve o payload inteiro.
create or replace function public.fetch_integracao_baixas_secure(p_store_id uuid, p_limite integer default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pend integer; v_erro integer; v_lista jsonb;
begin
  select count(*) filter (where status = 'pending'),
         count(*) filter (where status in ('erro', 'parcial', 'incerto'))
    into v_pend, v_erro
    from integracao_baixas where store_id = p_store_id;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_lista from (
    select b.id, b.order_id, b.rotulo, b.status, b.tentativas, b.ultimo_erro, b.resultado, b.proxima_tentativa, b.created_at, b.updated_at,
           jsonb_array_length(coalesce(b.payload -> 'itens', '[]'::jsonb)) as total_itens
      from integracao_baixas b
     where b.store_id = p_store_id and b.status <> 'ok'
     order by b.created_at desc
     limit greatest(1, least(coalesce(p_limite, 50), 200))
  ) x;
  return jsonb_build_object('pendentes', v_pend, 'com_erro', v_erro, 'itens', v_lista);
end;
$$;
grant execute on function public.fetch_integracao_baixas_secure(uuid, integer) to anon, authenticated;

notify pgrst, 'reload schema';
