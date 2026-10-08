-- 173: fechamento do turno com o faturamento certo e destrinchado (pedido do Joaquim, 08/10).
-- Achados nos dados reais do Sertão (desde 28/09):
--  1) taxa de serviço sumia: o cálculo usava payment_details.total, que em 17 contas NÃO inclui os 10%
--     (ex.: total 159,90 e pago 170,00). Agora a taxa sai do que foi PAGO (soma das formas).
--  2) cortesia entrava no "Total vendido" e no ticket médio. Cortesia não é faturamento: sai do total,
--     aparece à parte. Conta 100% cortesia não conta como conta paga nem gera taxa.
--  3) 30 contas fechadas em zero (tudo cancelado) contavam como "conta paga" e derrubavam o ticket médio.
--  4) cupom de desconto não era descontado da base, escondendo a taxa da conta com cupom.
--  5) venda estornada (status canceled) continuava somando.
--  6) a mesma conta contava 2x quando um dos pedidos da mesa ganhava marcas internas depois do pagamento
--     (op_enviada_em, faturamento_enviado_em...): o agrupamento usava o payment_details inteiro. Turno de 02/10:
--     mesa 22 (R$ 487,08) somada duas vezes. Agora a chave é só o que identifica o pagamento (_chave_conta_paga),
--     também no dinheiro esperado do caixa.
-- Cada conta fecha exatamente: itens - desconto + taxa de serviço + outras taxas + pago a mais - cortesia = recebido.
-- Campos antigos mantidos (apps antigos continuam funcionando); campos novos são aditivos.
-- Identifica UMA conta paga: o payment_id quando existe; senão mesa (ou pedido de balcão) + formas + total + operador.
-- Nunca o payment_details inteiro, que ganha marcas internas depois (op_enviada_em, faturamento_enviado_em...).
CREATE OR REPLACE FUNCTION public._chave_conta_paga(p_table_id uuid, p_order_id uuid, p_pd jsonb)
 RETURNS text LANGUAGE sql IMMUTABLE AS $$
  select coalesce(nullif(p_pd->>'payment_id', ''),
    coalesce(p_table_id::text, p_order_id::text) || '|' || md5(coalesce((p_pd->'methods')::text, '') || '|' ||
      coalesce(p_pd->>'total', '') || '|' || coalesce(p_pd->>'operador_id', '') || '|' || coalesce(p_pd->>'cash_shift_id', '')))
$$;

CREATE OR REPLACE FUNCTION public._cash_shift_expected_cash(p_shift_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce((select opening_float from cash_shifts where id = p_shift_id), 0)
    + coalesce((
      select sum((m->>'amount')::numeric)
      from (
        select distinct on (public._chave_conta_paga(o.table_id, o.id, o.payment_details)) o.payment_details
        from orders o
        where o.store_id = (select store_id from cash_shifts where id = p_shift_id)
          and o.payment_details->>'cash_shift_id' = p_shift_id::text
          and jsonb_typeof(o.payment_details->'methods') = 'array'
        order by public._chave_conta_paga(o.table_id, o.id, o.payment_details), o.id
      ) dedup, jsonb_array_elements(dedup.payment_details->'methods') m
      where m->>'method' = 'CASH'
    ), 0)
    - coalesce((select sum(amount) from cash_movements where shift_id = p_shift_id and type = 'sangria'), 0)
    + coalesce((select sum(amount) from cash_movements where shift_id = p_shift_id and type = 'suprimento'), 0);
$function$;

CREATE OR REPLACE FUNCTION public.fetch_cash_shift_summary_secure(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_shift cash_shifts%rowtype;
  v_rate numeric;
  v_auto boolean;
  v_totals_by_method jsonb;
  v_totals_by_brand jsonb;
  v_totals_by_card jsonb;
  v_sangria numeric;
  v_suprimento numeric;
  v_expected numeric;
  v_taxas_produto jsonb;
  v_res record;
  v_contas jsonb;
  v_produtos jsonb;
  v_movimentos jsonb;
  v_rows jsonb;
begin
  select * into v_shift from cash_shifts where id = p_shift_id;
  if not found then
    return null;
  end if;

  select coalesce((s.config->>'charge_service_fee')::boolean, false),
         coalesce(nullif(s.config->>'service_fee_rate', '')::numeric, 0.10)
    into v_auto, v_rate
  from stores s where s.id = v_shift.store_id;

  -- Uma linha por CONTA (pagamento), já decomposta. Pedidos da mesma mesa com o mesmo payment_details são a mesma conta.
  -- Taxa automática = o que foi pago acima de (itens - desconto + taxas lançadas como item). Até o percentual da loja é
  -- taxa de serviço; o que passar disso é "pago a mais" (gorjeta / troco não dado), mostrado à parte.
  with ped as (
    select o.id, o.table_id, o.status, o.payment_details as pd, coalesce(o.coupon_discount, 0) as desconto,
           coalesce(nullif(o.payment_details->>'pago_em', '')::timestamptz, o.updated_at) as quando,
           public._chave_conta_paga(o.table_id, o.id, o.payment_details) as conta
    from orders o
    where o.store_id = v_shift.store_id
      and o.payment_details->>'cash_shift_id' = p_shift_id::text
      and jsonb_typeof(o.payment_details->'methods') = 'array'
  ), it as (
    select ped.id,
      coalesce(sum(oi.price_at_time * oi.quantity) filter (where oi.status <> 'canceled' and p.fee_type is null), 0) as itens,
      coalesce(sum(oi.quantity) filter (where oi.status <> 'canceled' and p.fee_type is null), 0) as qtd_itens,
      coalesce(sum(oi.price_at_time * oi.quantity) filter (where oi.status <> 'canceled' and p.fee_type = 'percent'), 0) as taxa_item,
      coalesce(sum(oi.price_at_time * oi.quantity) filter (where oi.status <> 'canceled' and p.fee_type = 'fixed'), 0) as outras,
      coalesce(sum(oi.price_at_time * oi.quantity) filter (where oi.status = 'canceled' and p.fee_type is null), 0) as cancel_valor,
      coalesce(sum(oi.quantity) filter (where oi.status = 'canceled' and p.fee_type is null), 0) as cancel_qtd
    from ped
    left join order_items oi on oi.order_id = ped.id
    left join products p on p.id = oi.product_id
    group by ped.id
  ), contas as (
    select (array_agg(ped.table_id))[1] as table_id,
           case when bool_and(ped.table_id is null) then 'balcao' else 'mesa' end as tipo,
           bool_or(ped.status = 'canceled') as estornada, max(ped.quando) as quando,
           (array_agg(ped.pd))[1] as pd, sum(it.itens) as itens, sum(it.qtd_itens) as qtd_itens, sum(ped.desconto) as desconto,
           sum(it.taxa_item) as taxa_item, sum(it.outras) as outras, sum(it.cancel_valor) as cancel_valor, sum(it.cancel_qtd) as cancel_qtd
    from ped join it on it.id = ped.id
    group by ped.conta
  ), pagos as (
    select c.*,
      coalesce((select sum((m->>'amount')::numeric) from jsonb_array_elements(c.pd->'methods') m), 0) as bruto,
      coalesce((select sum((m->>'amount')::numeric) from jsonb_array_elements(c.pd->'methods') m where m->>'method' <> 'COURTESY'), 0) as recebido,
      coalesce((select sum((m->>'amount')::numeric) from jsonb_array_elements(c.pd->'methods') m where m->>'method' = 'COURTESY'), 0) as cortesia
    from contas c
  ), t1 as (
    select p.*, greatest(round(p.bruto - (p.itens - p.desconto) - p.taxa_item - p.outras, 2), 0) as taxa_auto from pagos p
  ), t2 as (
    select t1.*,
      case when t1.recebido > 0 and v_auto then least(t1.taxa_auto, round(greatest(t1.itens - t1.desconto, 0) * v_rate, 2) + 0.01) else 0 end as taxa_auto_ok
    from t1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'table_id', t2.table_id, 'mesa', (select tb.number::text from tables tb where tb.id = t2.table_id),
      'tipo', t2.tipo, 'estornada', t2.estornada, 'quando', t2.quando, 'operador', t2.pd->>'operador_nome', 'pd', t2.pd,
      'itens', t2.itens, 'qtd_itens', t2.qtd_itens, 'desconto', t2.desconto, 'outras', t2.outras,
      'cancel_valor', t2.cancel_valor, 'cancel_qtd', t2.cancel_qtd, 'bruto', t2.bruto, 'recebido', t2.recebido, 'cortesia', t2.cortesia,
      'taxa', case when t2.recebido > 0 then round(t2.taxa_auto_ok + t2.taxa_item, 2) else 0 end,
      'excesso', case when t2.recebido > 0 then greatest(round(t2.taxa_auto - t2.taxa_auto_ok, 2), 0) else 0 end
    ) order by t2.quando), '[]'::jsonb)
  into v_rows from t2;

  -- Formas de pagamento e bandeiras (cortesia fica em totals_by_method como COURTESY, mostrada à parte).
  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into v_totals_by_method
  from (select m->>'method' as method, sum((m->>'amount')::numeric) as total
          from jsonb_to_recordset(v_rows) as c(tipo text, mesa text, estornada boolean, quando timestamptz, operador text, pd jsonb, itens numeric, qtd_itens numeric, desconto numeric, outras numeric, cancel_valor numeric, cancel_qtd numeric, bruto numeric, recebido numeric, cortesia numeric, taxa numeric, excesso numeric), jsonb_array_elements(c.pd->'methods') m
         where not c.estornada group by 1) t;

  select coalesce(jsonb_object_agg(brand, total), '{}'::jsonb) into v_totals_by_brand
  from (select m->>'brand' as brand, sum((m->>'amount')::numeric) as total
          from jsonb_to_recordset(v_rows) as c(tipo text, mesa text, estornada boolean, quando timestamptz, operador text, pd jsonb, itens numeric, qtd_itens numeric, desconto numeric, outras numeric, cancel_valor numeric, cancel_qtd numeric, bruto numeric, recebido numeric, cortesia numeric, taxa numeric, excesso numeric), jsonb_array_elements(c.pd->'methods') m
         where not c.estornada and m->>'method' in ('CREDIT', 'DEBIT') and m->>'brand' is not null group by 1) t;

  select coalesce(jsonb_object_agg(k, total), '{}'::jsonb) into v_totals_by_card
  from (select (m->>'method') || '|' || coalesce(m->>'brand', '') as k, sum((m->>'amount')::numeric) as total
          from jsonb_to_recordset(v_rows) as c(tipo text, mesa text, estornada boolean, quando timestamptz, operador text, pd jsonb, itens numeric, qtd_itens numeric, desconto numeric, outras numeric, cancel_valor numeric, cancel_qtd numeric, bruto numeric, recebido numeric, cortesia numeric, taxa numeric, excesso numeric), jsonb_array_elements(c.pd->'methods') m
         where not c.estornada and m->>'method' in ('CREDIT', 'DEBIT') group by 1) t;

  select
    count(*) filter (where not estornada and recebido > 0) as contas,
    coalesce(sum(recebido) filter (where not estornada), 0) as recebido,
    coalesce(sum(itens) filter (where not estornada and recebido > 0), 0) as itens,
    coalesce(sum(qtd_itens) filter (where not estornada and recebido > 0), 0) as qtd_itens,
    coalesce(sum(desconto) filter (where not estornada and recebido > 0), 0) as desconto,
    coalesce(sum(taxa) filter (where not estornada), 0) as taxa,
    count(*) filter (where not estornada and taxa > 0) as taxa_qtd,
    coalesce(sum(outras) filter (where not estornada and recebido > 0), 0) as outras,
    coalesce(sum(excesso) filter (where not estornada), 0) as excesso,
    coalesce(sum(cortesia) filter (where not estornada and recebido > 0), 0) as cortesia_parcial,
    coalesce(sum(cortesia) filter (where not estornada), 0) as cortesia,
    count(*) filter (where not estornada and cortesia > 0) as cortesia_qtd,
    count(*) filter (where not estornada and bruto = 0) as zeradas,
    coalesce(sum(cancel_valor) filter (where not estornada), 0) as cancel_valor,
    coalesce(sum(cancel_qtd) filter (where not estornada), 0) as cancel_qtd,
    count(*) filter (where estornada) as estornadas,
    coalesce(sum(bruto) filter (where estornada), 0) as estornadas_valor
  into v_res from jsonb_to_recordset(v_rows) as c(tipo text, mesa text, estornada boolean, quando timestamptz, operador text, pd jsonb, itens numeric, qtd_itens numeric, desconto numeric, outras numeric, cancel_valor numeric, cancel_qtd numeric, bruto numeric, recebido numeric, cortesia numeric, taxa numeric, excesso numeric);

  select coalesce(jsonb_agg(jsonb_build_object(
      'quando', quando, 'mesa', mesa, 'tipo', tipo, 'operador', operador, 'itens', itens, 'desconto', desconto,
      'taxa', taxa, 'outras', outras, 'excesso', excesso, 'cortesia', cortesia, 'recebido', recebido,
      'cancelado', cancel_valor, 'estornada', estornada,
      'formas', (select coalesce(jsonb_agg(jsonb_build_object('method', m->>'method', 'brand', m->>'brand', 'amount', (m->>'amount')::numeric)), '[]'::jsonb)
                   from jsonb_array_elements(pd->'methods') m)
    ) order by quando), '[]'::jsonb)
    into v_contas from jsonb_to_recordset(v_rows) as c(tipo text, mesa text, estornada boolean, quando timestamptz, operador text, pd jsonb, itens numeric, qtd_itens numeric, desconto numeric, outras numeric, cancel_valor numeric, cancel_qtd numeric, bruto numeric, recebido numeric, cortesia numeric, taxa numeric, excesso numeric) where bruto > 0 or estornada;

  select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'categoria', categoria, 'quantidade', qtd, 'total', total)
           order by categoria, total desc, nome), '[]'::jsonb)
    into v_produtos
  from (
    select p.name as nome, coalesce(cat.name, 'Sem categoria') as categoria, sum(oi.quantity) as qtd, round(sum(oi.price_at_time * oi.quantity), 2) as total
    from orders o
    join order_items oi on oi.order_id = o.id and oi.status <> 'canceled'
    join products p on p.id = oi.product_id and p.fee_type is null
    left join categories cat on cat.id = p.category_id
    where o.store_id = v_shift.store_id
      and o.payment_details->>'cash_shift_id' = p_shift_id::text
      and o.status <> 'canceled'
      and coalesce((select sum((m->>'amount')::numeric) from jsonb_array_elements(case when jsonb_typeof(o.payment_details->'methods') = 'array' then o.payment_details->'methods' else '[]'::jsonb end) m where m->>'method' <> 'COURTESY'), 0) > 0
    group by p.name, cat.name
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('tipo', type, 'valor', amount, 'motivo', reason, 'quando', created_at) order by created_at), '[]'::jsonb)
    into v_movimentos from cash_movements where shift_id = p_shift_id;

  select coalesce(sum(amount), 0) into v_sangria from cash_movements where shift_id = p_shift_id and type = 'sangria';
  select coalesce(sum(amount), 0) into v_suprimento from cash_movements where shift_id = p_shift_id and type = 'suprimento';
  v_expected := public._cash_shift_expected_cash(p_shift_id);

  select coalesce(jsonb_object_agg(nome, jsonb_build_object('tipo', tipo, 'quantidade', qtd, 'total', total)), '{}'::jsonb)
    into v_taxas_produto
  from (
    select p.name as nome, min(p.fee_type) as tipo, sum(oi.quantity) as qtd, round(sum(oi.price_at_time * oi.quantity), 2) as total
    from orders o
    join order_items oi on oi.order_id = o.id and oi.status <> 'canceled'
    join products p on p.id = oi.product_id and p.fee_type is not null
    where o.store_id = v_shift.store_id
      and o.payment_details->>'cash_shift_id' = p_shift_id::text
      and o.status <> 'canceled'
    group by p.name
  ) t;

  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'totals_by_method', v_totals_by_method,
    'totals_by_brand', v_totals_by_brand,
    'totals_by_card', v_totals_by_card,
    'payments_count', v_res.contas,
    'payments_total', round(v_res.recebido, 2),
    'total_sangria', v_sangria,
    'total_suprimento', v_suprimento,
    'expected_cash', v_expected,
    'service_fee_total', round(v_res.taxa, 2),
    'service_fee_count', v_res.taxa_qtd,
    'fees_by_product', v_taxas_produto,
    'closing_counted_cash', v_shift.closing_counted_cash,
    'difference', case when v_shift.status = 'closed' then v_shift.closing_counted_cash - v_expected else null end,
    -- 173: faturamento destrinchado
    'items_total', round(v_res.itens, 2),
    'items_count', v_res.qtd_itens,
    'discount_total', round(v_res.desconto, 2),
    'other_fees_total', round(v_res.outras, 2),
    'overpaid_total', round(v_res.excesso, 2),
    'courtesy_total', round(v_res.cortesia, 2),
    'courtesy_partial_total', round(v_res.cortesia_parcial, 2),
    'courtesy_count', v_res.cortesia_qtd,
    'zeroed_count', v_res.zeradas,
    'canceled_items_total', round(v_res.cancel_valor, 2),
    'canceled_items_count', v_res.cancel_qtd,
    'refunded_count', v_res.estornadas,
    'refunded_total', round(v_res.estornadas_valor, 2),
    'accounts', v_contas,
    'products', v_produtos,
    'movements', v_movimentos
  );
end;
$function$;

NOTIFY pgrst, 'reload schema';
