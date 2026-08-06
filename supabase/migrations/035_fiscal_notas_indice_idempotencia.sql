-- Idempotência de emissão fiscal (2026-08-05, achado em revisão do Task 13
-- de docs/superpowers/specs/2026-08-05-emissao-fiscal-automatica-design.md):
-- nada em app/api/fiscal/emitir/route.ts impedia duas chamadas
-- concorrentes/duplicadas pro mesmo orderId/tableId (retry de rede do
-- fire-and-forget que dispara essa rota, ou dois garçons fechando a mesma
-- mesa quase ao mesmo tempo) de rodarem o pipeline duas vezes e gerarem
-- DOIS documentos fiscais autorizados pra mesma venda, cada um com número
-- próprio — problema real de compliance perante a SEFAZ (documento
-- autorizado não pode ser simplesmente descartado, todo número precisa ser
-- contabilizado). A rota já ganhou uma checagem em SELECT antes de rodar o
-- pipeline, mas isso sozinho não fecha a janela de corrida clássica entre
-- "checar" e "agir" quando duas requisições chegam quase ao mesmo tempo —
-- este índice único parcial é o backstop de banco pra esse caso.
--
-- 'erro'/'rejeitada' ficam de fora do índice de propósito: uma tentativa
-- que falhou antes de qualquer documento existir na SEFAZ deve continuar
-- permitindo nova tentativa (reemissão) livremente — só 'autorizada'
-- (documento real já existe) e 'pendente' (linha em andamento/aguardando
-- dado, ex. destinatário faltando numa NF-e, Task 17) contam como "já
-- existe ou pode existir uma nota pra esta venda", e por isso travam uma
-- segunda linha pro mesmo store_id + table_id/order_id.
--
-- coalesce com um UUID sentinela (nunca gerado de verdade por
-- gen_random_uuid) trata table_id/order_id null como um valor comparável —
-- índice único normal não bloqueia duas linhas com null na mesma coluna
-- (null nunca é igual a null pra fins de unicidade no Postgres).
create unique index if not exists fiscal_notas_unico_por_venda on fiscal_notas (
  store_id,
  coalesce(table_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where status in ('autorizada', 'pendente');
