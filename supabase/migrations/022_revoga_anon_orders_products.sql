-- Fecha o achado critico: allow_all_anon (migration 001) cobria SELECT
-- aberto em orders/order_items (vazamento de nome/pagamento de cliente de
-- qualquer loja) e INSERT/UPDATE/DELETE aberto em orders/order_items/
-- products (preco adulteravel direto via REST, sem passar por
-- create_order_secure/update_product_secure). Todo acesso real ja migrou
-- pras RPCs security definer da migration 021 -- este e' so o corte do
-- caminho antigo. Ver docs/plans/2026-07-07-fecha-rls-orders-products-plan.md.
--
-- Testado ao vivo antes de aplicar (2026-07-07): 18 RPCs da migration 021,
-- 14 via fluxo real de UI (Playwright: balcao, KDS, mesa, editar/criar/
-- excluir produto, historico de vendas) + 4 via chamada direta (cancelar
-- item, cancelar itens pendentes de mesa, limpar historico, duplicar
-- produtos), todas com dado descartavel limpo depois. Zero regressao
-- encontrada nos 18 pontos.

drop policy if exists allow_all_anon on orders;
drop policy if exists allow_all_anon on order_items;
-- products continua com SELECT publico (cardapio tem que ser legivel sem
-- login), so perde INSERT/UPDATE/DELETE direto.
drop policy if exists allow_all_anon on products;

create policy select_orders_none on orders for select using (false);
create policy select_order_items_none on order_items for select using (false);
create policy select_products_anon on products for select using (true);
