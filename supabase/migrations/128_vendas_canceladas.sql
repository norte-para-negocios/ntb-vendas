-- Aba "Canceladas" do Histórico de vendas (2026-09-29, pedido do dono): o histórico só lista
-- pedidos 'delivered', então venda cancelada (inclusive a estornada por cancelamento de nota
-- fiscal, ver lib/fiscal/estornoDaVenda.ts) sumia sem deixar onde consultar.
-- Devolve dois blocos: `pedidos` (orders.status='canceled', com itens, mesa e notas
-- fiscais canceladas) e `itens` (itens cancelados de pedidos que CONTINUARAM valendo).
create or replace function public.fetch_canceled_sales_secure(
  p_store_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pedidos', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select o.id, o.order_type, o.customer_name, o.created_at, o.updated_at, o.total,
          coalesce(o.payment_details->'estornado_por_cancelamento_de_nota', o.payment_details) as pagamento,
          (o.payment_details ? 'estornado_por_cancelamento_de_nota') as estornado_por_nota,
          (select tb.number from tables tb where tb.id = o.table_id) as mesa,
          (select coalesce(jsonb_agg(jsonb_build_object('quantity', oi.quantity, 'price_at_time', oi.price_at_time, 'product_name', p.name)), '[]'::jsonb)
             from order_items oi left join products p on p.id = oi.product_id where oi.order_id = o.id) as itens,
          (select coalesce(jsonb_agg(jsonb_build_object('numero', n.numero, 'serie', n.serie, 'modelo', n.modelo, 'cancelada_em', n.cancelada_em, 'justificativa', n.cancelamento_justificativa) order by n.numero), '[]'::jsonb)
             from fiscal_notas n where n.order_id = o.id and n.status = 'cancelada') as notas
        from orders o
        where o.store_id = p_store_id and o.status = 'canceled'
          and (p_start_date is null or o.created_at >= p_start_date)
          and (p_end_date is null or o.created_at <= p_end_date)
        order by o.updated_at desc
        limit 500
      ) t
    ), '[]'::jsonb),
    'itens', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select oi.id, oi.quantity, oi.price_at_time, oi.created_at, p.name as product_name, o.order_type,
          (select tb.number from tables tb where tb.id = o.table_id) as mesa
        from order_items oi
        join orders o on o.id = oi.order_id
        left join products p on p.id = oi.product_id
        where o.store_id = p_store_id and oi.status = 'canceled' and o.status <> 'canceled'
          and (p_start_date is null or oi.created_at >= p_start_date)
          and (p_end_date is null or oi.created_at <= p_end_date)
        order by oi.created_at desc
        limit 500
      ) t
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.fetch_canceled_sales_secure(uuid, timestamptz, timestamptz) to anon, authenticated;
notify pgrst, 'reload schema';
