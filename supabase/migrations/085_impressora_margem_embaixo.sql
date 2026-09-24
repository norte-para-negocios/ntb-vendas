-- Linhas em branco no fim de cada impressão (pra cortar/rasgar o papel certo
-- quando a impressora não corta sozinha). Ligado por impressora.
alter table printer_configs add column if not exists bottom_margin boolean not null default false;
notify pgrst, 'reload schema';
