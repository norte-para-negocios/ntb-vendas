-- 157: resultado do envio da NFC-e autorizada ao Omie (ImportarNFCe), gravado na própria nota (04/10/2026, auditoria I7).
-- Antes o envio era fire-and-forget sem olhar a resposta: falha só ia pro log. Agora o resultado fica visível em
-- Administração > Vendas > Notas fiscais. ADITIVA: só colunas novas (fetch_fiscal_notas_secure já devolve select *).
alter table public.fiscal_notas add column if not exists omie_status text;
alter table public.fiscal_notas add column if not exists omie_erro text;
alter table public.fiscal_notas add column if not exists omie_em timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fiscal_notas_omie_status_check') then
    alter table public.fiscal_notas add constraint fiscal_notas_omie_status_check
      check (omie_status is null or omie_status in ('ok', 'na_fila', 'ignorada', 'erro'));
  end if;
end $$;
notify pgrst, 'reload schema';
