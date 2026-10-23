-- 184: guarda o XML assinado da tentativa ONLINE quando a NFC-e cai em contingência (incidente Sertão out/2026).
-- Timeout no envio não quer dizer que a SEFAZ não autorizou: 14 cupons foram autorizados pela tentativa online e a
-- contingência (mesmo número, outra chave) voltou 539. Com este XML a retransmissão consulta a chave online e, se ela
-- estiver autorizada, promove a nota com o documento CERTO em vez de marcar 'rejeitada'. Aditiva.
alter table public.fiscal_notas add column if not exists xml_online_tentativa text;
notify pgrst, 'reload schema';
