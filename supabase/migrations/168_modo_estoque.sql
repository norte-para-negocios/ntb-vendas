-- 168 — Modo de estoque por loja (06/10/2026). Aditiva: toda loja existente fica em 'omie' (comportamento de hoje).
--   omie    = baixa via Estoque -> Omie (como sempre)
--   proprio = baixa via Estoque próprio (ledger do Norte Estoque), sem Omie
--   nenhum  = só venda e nota, sem baixa de estoque
-- A coluna é pública como o resto de `stores` (não é segredo; `stores` tem grant de tabela inteira, a coluna entra sozinha).
alter table public.stores add column if not exists stock_mode text not null default 'omie';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stores_stock_mode_chk') then
    alter table public.stores add constraint stores_stock_mode_chk check (stock_mode in ('omie', 'proprio', 'nenhum'));
  end if;
end $$;

-- A loja que já teve baixa de estoque não troca de modo pela tela (o histórico ficaria em outro sistema).
create or replace function public.store_tem_baixas_secure(p_store_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from integracao_baixas where store_id = p_store_id)
$$;
grant execute on function public.store_tem_baixas_secure(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
