-- Achado da revisão final de branch (2026-08-06): o índice único parcial
-- `fiscal_notas_unico_por_venda` (037_fiscal_notas_pendente_nao_bloqueia_
-- idempotencia.sql) usa `coalesce(order_id, '00000...0'::uuid)` pra tratar
-- `order_id is null` como um valor comparável — mas `fiscal_notas.order_id`
-- é `references orders(id) on delete set null`. `clear_sales_history_secure`
-- (021_fecha_rls_orders_products.sql) apaga TODAS as orders de uma loja
-- numa única instrução (`delete from orders where store_id = p_store_id`),
-- o que colapsa o `order_id` de TODA nota 'autorizada' daquela loja pra
-- `null` na mesma transação. A partir da 2ª nota 'autorizada' sem table_id
-- (ou com o mesmo table_id) que colapsa pro mesmo
-- `(store_id, sentinel, sentinel)`, o índice único é violado e a instrução
-- INTEIRA de `clear_sales_history_secure` falha — não só a parte fiscal, o
-- lojista fica sem conseguir limpar o histórico de vendas de jeito nenhum.
-- Como a emissão automática (Task 14) roda em todo fechamento real, isso
-- não é um edge case raro: qualquer loja ativa acumula 2+ notas
-- 'autorizada' num único dia.
--
-- Fix de uma linha: `order_id is not null` no where do índice — uma nota
-- sem `order_id` (incluindo o `order_id` que virou null por cascade) nunca
-- deveria contar pra unicidade, já que `order_id` é a âncora que identifica
-- a VENDA (ver comentário extenso em app/api/fiscal/emitir/route.ts sobre
-- por que `table_id` sozinho não basta) — sem `order_id`, não tem como essa
-- linha representar "a mesma venda" de outra pra fins de bloqueio de
-- duplicata; o índice existe pra impedir DUAS notas autorizadas pra UMA
-- venda, não pra impedir várias notas com âncora perdida de coexistir.
drop index if exists fiscal_notas_unico_por_venda;

create unique index if not exists fiscal_notas_unico_por_venda on fiscal_notas (
  store_id,
  coalesce(table_id, '00000000-0000-0000-0000-000000000000'::uuid),
  order_id
) where status = 'autorizada' and order_id is not null;
