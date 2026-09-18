-- Largura do papel por impressora (58mm / 80mm / 210mm = A4). Antes só existia
-- stores.config.printer_paper_width_mm (uma largura pra loja toda) e o cupom
-- fiscal (PDF) nem olhava pra ela — saía pequeno "independente do tamanho".
alter table printer_configs
  add column if not exists paper_width_mm integer not null default 80
  check (paper_width_mm in (58, 80, 210));

notify pgrst, 'reload schema';
