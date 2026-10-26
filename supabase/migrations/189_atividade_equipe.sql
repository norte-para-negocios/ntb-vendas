-- 189 — Atividade da equipe para a aba Relatórios → Equipe (26/10/2026, pedido do dono: "ver por login o que cada
-- pessoa fez"). Só leitura e aditiva. Entrega os eventos do app gravados em staff_audit_log (entrou/saiu, pré-conta,
-- troca de mesa, pediu conta, senha não conferida) e a abertura de mesa (table_sessions.insert vira 'mesa.abriu').
-- Fora: linhas sem login e o detalhe cru das triggers (linha/mudou), que não interessam ao relatório.
create or replace function public.fetch_atividade_equipe_secure(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with ev as (
    select occurred_at, actor_name, actor_role,
           case when origin = 'app' then action else 'mesa.abriu' end as acao,
           summary, (details - 'linha' - 'mudou') as detalhe
      from staff_audit_log
     where store_id = p_store_id and occurred_at >= p_from and occurred_at < p_to
       and coalesce(actor_name, '(sem login)') <> '(sem login)'
       and (origin = 'app' or action = 'table_sessions.insert')
  ), lim as (select * from ev order by occurred_at limit 5000)
  select jsonb_build_object(
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('quando', occurred_at, 'quem', actor_name, 'papel', actor_role,
                         'acao', acao, 'resumo', summary, 'detalhe', detalhe) order by occurred_at) from lim), '[]'::jsonb),
    'cortado', (select count(*) > 5000 from ev));
$$;
grant execute on function public.fetch_atividade_equipe_secure(uuid, timestamptz, timestamptz) to anon, authenticated;
