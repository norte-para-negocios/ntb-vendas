-- 167 — Trava de emissão fiscal NO BANCO (06/10/2026). A trava em memória do servidor (rota /api/fiscal/emitir) só vale dentro de um
-- processo; esta vale para qualquer processo, reinício ou origem: duas emissões da MESMA venda nunca rodam ao mesmo tempo.
-- Só a service role usa estas funções. A trava expira sozinha (padrão 5 min) se um processo morrer no meio.
create table if not exists public.fiscal_emissao_trava (
  chave text primary key,
  criada_em timestamptz not null default now()
);
alter table public.fiscal_emissao_trava enable row level security;
revoke all on public.fiscal_emissao_trava from anon, authenticated;

create or replace function public.adquirir_trava_emissao(p_chave text, p_ttl_seg int default 300)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_chave is null or length(p_chave) < 8 then return false; end if;
  delete from fiscal_emissao_trava where chave = p_chave and criada_em < clock_timestamp() - make_interval(secs => greatest(p_ttl_seg, 0));
  insert into fiscal_emissao_trava (chave, criada_em) values (p_chave, clock_timestamp()) on conflict (chave) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.liberar_trava_emissao(p_chave text)
returns void language sql security definer set search_path = public as $$
  delete from fiscal_emissao_trava where chave = p_chave;
$$;

revoke all on function public.adquirir_trava_emissao(text, int) from public, anon, authenticated;
revoke all on function public.liberar_trava_emissao(text) from public, anon, authenticated;
grant execute on function public.adquirir_trava_emissao(text, int) to service_role;
grant execute on function public.liberar_trava_emissao(text) to service_role;
notify pgrst, 'reload schema';
