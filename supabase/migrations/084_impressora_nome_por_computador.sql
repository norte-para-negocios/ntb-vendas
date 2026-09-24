-- A mesma impressora física tem nomes diferentes em cada computador do
-- Windows (PC-SERVIDORR: "IMPCOZINHA", notebook: "COZINHA"). Mapa
-- hostname -> nome local, pra qualquer computador da loja imprimir nela.
alter table printer_configs add column if not exists machine_names jsonb not null default '{}'::jsonb;
notify pgrst, 'reload schema';
