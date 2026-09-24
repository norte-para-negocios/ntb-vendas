-- Nome amigável da impressora achada na rede (DNS reverso / mDNS), pra o
-- painel mostrar "EPSON-TM20 (192.168.0.50)" em vez de só o IP.
alter table discovered_printers add column if not exists label text not null default '';
notify pgrst, 'reload schema';
