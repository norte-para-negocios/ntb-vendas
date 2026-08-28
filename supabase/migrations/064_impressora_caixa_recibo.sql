-- Achado ao vivo (2026-08-28, dono testando na loja com 3 impressoras
-- cabeadas de verdade: Cozinha, Bar, e a do Caixa pra imprimir o
-- comprovante/recibo do cliente ao fechar o pagamento). A aba Impressão
-- (migration 061) só tinha destino 'kitchen'/'bar'/'all' -- pensada só
-- pra ticket de pedido. Adiciona 'receipt' (comprovante de pagamento,
-- printBillReceipt) como destino próprio, sem mexer nos dois já
-- existentes.

alter table printer_configs drop constraint if exists printer_configs_destination_check;
alter table printer_configs add constraint printer_configs_destination_check
  check (destination in ('kitchen', 'bar', 'all', 'receipt'));

alter table print_jobs drop constraint if exists print_jobs_destination_check;
alter table print_jobs add constraint print_jobs_destination_check
  check (destination in ('kitchen', 'bar', 'all', 'receipt'));
