-- Qual computador publicou cada impressora detectada (o painel mostra
-- "BAR — CAIXA-PC" pra não misturar impressoras de PCs diferentes da loja).
alter table discovered_printers add column if not exists machine text not null default '';
notify pgrst, 'reload schema';
