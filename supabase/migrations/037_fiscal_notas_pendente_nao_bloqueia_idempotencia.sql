-- Task 17 (2026-08-06): 'pendente' deixa de bloquear a idempotência de
-- fiscal_notas, tanto no índice único do banco (este arquivo) quanto na
-- checagem em código (app/api/fiscal/emitir/route.ts) — complementa
-- 035_fiscal_notas_indice_idempotencia.sql/036_..._fix.sql.
--
-- Task 17 introduz o primeiro caminho de código que de fato grava
-- status='pendente' (falta CPF/CNPJ do destinatário pra NF-e, checado ANTES
-- da numeração/transmissão — nenhum documento chega a existir na SEFAZ).
-- O índice de 035/036 cobria `where status in ('autorizada', 'pendente')`,
-- pensado pra um 'pendente' que na época era só um valor reservado no CHECK
-- constraint, nunca gravado por nenhum código. Sem este ajuste, o fluxo que
-- esta task existe pra viabilizar ("lojista preenche o documento depois e
-- clica Reemitir") ficaria travado: a linha 'pendente' já existente bateria
-- no índice único e o INSERT da reemissão bem-sucedida (agora 'erro',
-- 'rejeitada' ou 'autorizada') falharia com violação de unicidade.
--
-- 'pendente', assim como 'erro'/'rejeitada', nunca representa um documento
-- real na SEFAZ — só 'autorizada' representa. Não faz sentido nenhum dos
-- três bloquear uma tentativa futura pra mesma venda; só 'autorizada' deve.
drop index if exists fiscal_notas_unico_por_venda;

create unique index if not exists fiscal_notas_unico_por_venda on fiscal_notas (
  store_id,
  coalesce(table_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where status = 'autorizada';
