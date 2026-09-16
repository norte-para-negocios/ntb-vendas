-- Contingência fiscal NFC-e offline (2026-09-15, pedido ao vivo loja
-- Sertão): quando a SEFAZ/internet cai, a nota é emitida com tpEmis=9 e
-- fica pendente de retransmissão — precisa de um status novo e de um
-- lugar pra guardar o XML assinado que será reenviado depois.
alter table fiscal_notas drop constraint if exists fiscal_notas_status_check;
alter table fiscal_notas add constraint fiscal_notas_status_check
  check (status in ('pendente', 'autorizada', 'rejeitada', 'erro', 'contingencia'));

alter table fiscal_notas add column if not exists xml_contingencia text;

notify pgrst, 'reload schema';
