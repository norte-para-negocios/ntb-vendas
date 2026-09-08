-- Achado real (Ramon, WhatsApp 2026-09-08, loja "O Sertão Vai Virar Mar"):
-- na tela "Conta da Mesa" do cliente (BillSplitter, ClientModule.tsx),
-- TODO item aparecia como "Produto Indisponível" mesmo sendo produto real
-- e disponível — confirmado comparando com a visão do lojista na mesma
-- mesa, que mostrava os nomes certos.
--
-- Causa raiz: fetch_table_order_summary_secure (única fonte de dado do
-- BillSplitter, via fetchTableOrderSummary em lib/api.ts) sempre fez
-- jsonb_agg(to_jsonb(oi)) — a linha CRUA de order_items, sem NENHUM join
-- com products. getOrderItemDisplayName (lib/labels.ts) cai no fallback
-- 'Produto Indisponível' sempre que item.product é null/undefined — e
-- aqui SEMPRE era, pra qualquer item, não só produto de fato indisponível.
-- Não é bug intermitente, é 100% dos itens desta tela específica, desde
-- que essa function existe.
--
-- Fix: mesmo padrão já usado em fetch_active_table_orders_secure
-- (migration 021) — left join com products, embutido como jsonb em
-- `product`. left join (não inner) de propósito: um item de produto já
-- excluído (product_id null, on delete set null) continua aparecendo
-- com product:null, em vez de sumir da conta do cliente.
create or replace function public.fetch_table_order_summary_secure(p_table_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total', coalesce(sum(oi.price_at_time * oi.quantity) filter (where oi.status != 'canceled'), 0),
    'items', coalesce(
      jsonb_agg(to_jsonb(oi) || jsonb_build_object('product', to_jsonb(p))) filter (where oi.status != 'canceled'),
      '[]'::jsonb
    )
  )
  from orders o
  join order_items oi on oi.order_id = o.id
  left join products p on p.id = oi.product_id
  where o.table_id = p_table_id and o.status not in ('delivered', 'canceled');
$$;

notify pgrst, 'reload schema';
