-- Impressoras detectadas agora podem ser 'system' (instalada no sistema do
-- computador) ou 'network' (achada na rede local, porta 9100, name = "ip:porta").
alter table discovered_printers add column if not exists kind text not null default 'system';
notify pgrst, 'reload schema';
