-- 'driver' = imprime pelo driver do Windows (GDI, como sempre foi);
-- 'raw' = manda ESC/POS direto pra impressora térmica (ignora o driver:
-- resolve fonte/escala/margem errada de drivers ruins). Só USB local.
alter table printer_configs add column if not exists print_mode text not null default 'driver' check (print_mode in ('driver','raw'));
notify pgrst, 'reload schema';
