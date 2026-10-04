-- 147: fechamento do turno separa CRÉDITO e DÉBITO por bandeira (totals_by_card), traz contas/total/ticket médio
-- e CORRIGE a dupla contagem: pedidos da mesma conta (ex.: pedido principal + pedido da taxa) dividem o mesmo
-- payment_details e eram somados uma vez por pedido (turno 02/10: Crédito 1.865,81 contra 1.419,53 real).
-- Agora totals_by_method/brand/card seguem a mesma deduplicação de _cash_shift_expected_cash.
-- Original da 147:
-- (payments_count, payments_total — pedido do Ramon 03/10: "o ticket médio não aparece no fechamento do caixa").
-- Pedido do Ramon: o resumo de cartões somava crédito+débito da mesma bandeira e
-- ignorava cartão sem bandeira. Mantém totals_by_brand (apps antigos). Base: 139.
-- Fechamento do turno (137) + taxas como item.
-- Mudanças: (1) agrupa por PAGAMENTO (close_table_orders_secure copia o mesmo
-- payment_details em todos os pedidos da mesa; com o pedido de taxas a mesa
-- passa a ter 2+ pedidos e "total pago - total do pedido" por pedido contaria
-- a taxa várias vezes); (2) subtotal vem dos itens não cancelados (orders.total
-- não desconta item cancelado); (3) taxa = automática (pago - itens) + itens de
-- taxa percentual; (4) fees_by_product: cada produto-taxa do turno (qtd/total).
CREATE OR REPLACE FUNCTION public.fetch_cash_shift_summary_secure(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shift cash_shifts%rowtype;
  v_totals_by_method jsonb;
  v_totals_by_brand jsonb;
  v_totals_by_card jsonb;
  v_pay_count int;
  v_pay_total numeric;
  v_sangria numeric;
  v_suprimento numeric;
  v_expected numeric;
  v_taxa_total numeric;
  v_taxa_qtd int;
  v_taxas_produto jsonb;
begin
  select * into v_shift from cash_shifts where id = p_shift_id;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into v_totals_by_method
  from (
    select m->>'method' as method, sum((m->>'amount')::numeric) as total
    from (select distinct on (coalesce(x.table_id::text, x.id::text), x.payment_details) x.payment_details, x.store_id
       from orders x
      where x.store_id = v_shift.store_id and x.payment_details->>'cash_shift_id' = p_shift_id::text
      order by coalesce(x.table_id::text, x.id::text), x.payment_details, x.id) o, jsonb_array_elements(o.payment_details->'methods') m
    where o.store_id = v_shift.store_id
      and o.payment_details->>'cash_shift_id' = p_shift_id::text
    group by m->>'method'
  ) t;

  select coalesce(jsonb_object_agg(brand, total), '{}'::jsonb) into v_totals_by_brand
  from (
    select m->>'brand' as brand, sum((m->>'amount')::numeric) as total
    from (select distinct on (coalesce(x.table_id::text, x.id::text), x.payment_details) x.payment_details, x.store_id
       from orders x
      where x.store_id = v_shift.store_id and x.payment_details->>'cash_shift_id' = p_shift_id::text
      order by coalesce(x.table_id::text, x.id::text), x.payment_details, x.id) o, jsonb_array_elements(o.payment_details->'methods') m
    where o.store_id = v_shift.store_id
      and o.payment_details->>'cash_shift_id' = p_shift_id::text
      and m->>'method' in ('CREDIT', 'DEBIT')
      and m->>'brand' is not null
    group by m->>'brand'
  ) t;

  select coalesce(jsonb_object_agg(k, total), '{}'::jsonb) into v_totals_by_card
  from (
    select (m->>'method') || '|' || coalesce(m->>'brand', '') as k, sum((m->>'amount')::numeric) as total
    from (select distinct on (coalesce(x.table_id::text, x.id::text), x.payment_details) x.payment_details, x.store_id
       from orders x
      where x.store_id = v_shift.store_id and x.payment_details->>'cash_shift_id' = p_shift_id::text
      order by coalesce(x.table_id::text, x.id::text), x.payment_details, x.id) o, jsonb_array_elements(o.payment_details->'methods') m
    where o.store_id = v_shift.store_id
      and o.payment_details->>'cash_shift_id' = p_shift_id::text
      and m->>'method' in ('CREDIT', 'DEBIT')
    group by m->>'method', coalesce(m->>'brand', '')
  ) t;

  -- Contas pagas no turno (mesa com vários pedidos = 1 conta; cada pedido de balcão = 1 conta) e total recebido.
  -- Total = valor efetivamente recebido (soma das formas de pagamento), igual ao TOTAL do relatório; o campo
  -- payment_details.total nem sempre inclui a taxa digitada pelo caixa.
  select count(*), coalesce(sum((select sum((m->>'amount')::numeric) from jsonb_array_elements(g.payment_details->'methods') m)), 0)
    into v_pay_count, v_pay_total
  from (select distinct on (coalesce(x.table_id::text, x.id::text), x.payment_details) x.payment_details
          from orders x
         where x.store_id = v_shift.store_id and x.payment_details->>'cash_shift_id' = p_shift_id::text
           and jsonb_typeof(x.payment_details->'methods') = 'array'
         order by coalesce(x.table_id::text, x.id::text), x.payment_details, x.id) g;

  select coalesce(sum(amount), 0) into v_sangria from cash_movements where shift_id = p_shift_id and type = 'sangria';
  select coalesce(sum(amount), 0) into v_suprimento from cash_movements where shift_id = p_shift_id and type = 'suprimento';
  v_expected := public._cash_shift_expected_cash(p_shift_id);

  with ped as (
    select o.id, o.table_id, o.payment_details as pd
    from orders o
    where o.store_id = v_shift.store_id
      and o.payment_details->>'cash_shift_id' = p_shift_id::text
      and o.table_id is not null
      and (o.payment_details->>'total') is not null
  ), itens as (
    select ped.id as order_id,
      coalesce(sum(oi.price_at_time * oi.quantity) filter (where oi.id is not null and p.fee_type is null), 0) as itens,
      coalesce(sum(oi.price_at_time * oi.quantity) filter (where p.fee_type = 'percent'), 0) as taxa_item,
      coalesce(sum(oi.price_at_time * oi.quantity) filter (where p.fee_type = 'fixed'), 0) as outras
    from ped
    left join order_items oi on oi.order_id = ped.id and oi.status <> 'canceled'
    left join products p on p.id = oi.product_id
    group by ped.id
  ), pagamentos as (
    select (ped.pd->>'total')::numeric as pago, sum(i.itens) as itens, sum(i.taxa_item) as taxa_item, sum(i.outras) as outras
    from ped join itens i on i.order_id = ped.id
    group by ped.table_id, ped.pd->>'total', ped.pd->'methods', ped.pd->>'operador_id'
  )
  select coalesce(sum(taxa), 0), count(*) filter (where taxa > 0) into v_taxa_total, v_taxa_qtd
  from (
    select greatest(round(pago - itens - taxa_item - outras, 2), 0) + taxa_item as taxa
    from pagamentos
  ) t;

  select coalesce(jsonb_object_agg(nome, jsonb_build_object('tipo', tipo, 'quantidade', qtd, 'total', total)), '{}'::jsonb)
    into v_taxas_produto
  from (
    select p.name as nome, min(p.fee_type) as tipo, sum(oi.quantity) as qtd, round(sum(oi.price_at_time * oi.quantity), 2) as total
    from orders o
    join order_items oi on oi.order_id = o.id and oi.status <> 'canceled'
    join products p on p.id = oi.product_id and p.fee_type is not null
    where o.store_id = v_shift.store_id
      and o.payment_details->>'cash_shift_id' = p_shift_id::text
    group by p.name
  ) t;

  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'totals_by_method', v_totals_by_method,
    'totals_by_brand', v_totals_by_brand,
    'totals_by_card', v_totals_by_card,
    'payments_count', v_pay_count,
    'payments_total', round(v_pay_total, 2),
    'total_sangria', v_sangria,
    'total_suprimento', v_suprimento,
    'expected_cash', v_expected,
    'service_fee_total', v_taxa_total,
    'service_fee_count', v_taxa_qtd,
    'fees_by_product', v_taxas_produto,
    'closing_counted_cash', v_shift.closing_counted_cash,
    'difference', case when v_shift.status = 'closed' then v_shift.closing_counted_cash - v_expected else null end
  );
end;
$function$;

NOTIFY pgrst, 'reload schema';
