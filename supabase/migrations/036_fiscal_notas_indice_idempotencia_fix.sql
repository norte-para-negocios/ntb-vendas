-- Corrige o índice de idempotência de fiscal_notas (2026-08-05, achado em
-- 2ª rodada de revisão do Task 13, complementa
-- 035_fiscal_notas_indice_idempotencia.sql).
--
-- BUG CRÍTICO da 035: o índice sozinho tinha a MESMA formula de hoje
-- (store_id + coalesce(table_id,...) + coalesce(order_id,...)), mas o
-- código em app/api/fiscal/emitir/route.ts, no caminho de fechamento de
-- MESA, sempre gravava `order_id = null` — e `table_id` identifica a mesa
-- FÍSICA, reutilizada o dia inteiro (mesa 5 do almoço e mesa 5 do jantar
-- são vendas diferentes, mas o mesmo `table_id`). Com `order_id` sempre
-- null nesse caminho, a chave efetiva do índice virava só
-- `(store_id, table_id)` na prática — a PRIMEIRA nota autorizada de
-- qualquer mesa passava a bloquear TODA venda futura daquela mesa pra
-- sempre (silenciosamente, numa chamada fire-and-forget que ninguém
-- observa). Pior que o problema original que o índice existia pra
-- resolver: nota fiscal nunca mais seria emitida pra aquela mesa.
--
-- Corrigido no código (route.ts agora sempre popula `order_id` com a
-- primeira `order` da sessão de fechamento — uma "âncora" que identifica a
-- VENDA, não a mesa; duas sessões de fechamento diferentes da mesma mesa
-- sempre têm `orders` com UUIDs novos, nunca colidem). Este índice
-- (mesma fórmula da 035, recriado aqui de propósito — não é migration
-- vazia: existir como arquivo próprio deixa auditável que o dado
-- protegido por ele era outro na 035) só volta a ser um backstop correto
-- DEPOIS dessa correção de código; por isso dropar e recriar em vez de só
-- deixar a 035 como está.
drop index if exists fiscal_notas_unico_por_venda;

create unique index if not exists fiscal_notas_unico_por_venda on fiscal_notas (
  store_id,
  coalesce(table_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where status in ('autorizada', 'pendente');
