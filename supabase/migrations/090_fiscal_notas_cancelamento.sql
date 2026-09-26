-- Cancelamento de nota fiscal (evento 110111), pedido do Ramon (loja "O
-- Sertão Vai Virar Mar"), 2026-09-26. Só DDL aditivo: novo status
-- 'cancelada' no CHECK + colunas com o registro do evento. A rota que grava
-- é app/api/fiscal/cancelar (service role). fetch_fiscal_notas_secure
-- (migration 039) já devolve `select *`, então as colunas novas aparecem na
-- tela sem mudar a função.

alter table fiscal_notas drop constraint if exists fiscal_notas_status_check;
alter table fiscal_notas add constraint fiscal_notas_status_check
  check (status in ('pendente', 'autorizada', 'rejeitada', 'erro', 'contingencia', 'cancelada'));

alter table fiscal_notas add column if not exists cancelada_em timestamptz;
alter table fiscal_notas add column if not exists cancelamento_protocolo text;
alter table fiscal_notas add column if not exists cancelamento_justificativa text;
-- procEventoNFe (evento assinado + retEvento da SEFAZ): comprovante do cancelamento.
alter table fiscal_notas add column if not exists cancelamento_xml text;

notify pgrst, 'reload schema';
