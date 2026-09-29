-- Onde cada documento imprime: lista de tipos de documento que a impressora recebe
-- (comanda, pre_conta, comprovante, cupom_fiscal, fechamento_caixa). NULL/vazio = padrão pelo destino.
alter table printer_configs add column if not exists documentos text[];
