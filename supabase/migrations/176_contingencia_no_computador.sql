-- NFC-e em contingência feita no computador da loja sem internet (08/10/2026).
-- Cada computador (device_id do app do Windows) ganha uma SÉRIE própria por loja/ambiente, para a numeração dele
-- nunca colidir com a do servidor nem com a de outro computador. `ultimo_numero` = maior número já registrado
-- por /api/fiscal/registrar-contingencia (o PC guarda o próprio contador e usa o maior dos dois).
-- Só o servidor (service role) lê/grava: RLS ligada e nenhuma policy.
create table if not exists public.fiscal_contingencia_series (
  store_id uuid not null references public.stores(id) on delete cascade,
  device_id text not null,
  ambiente text not null check (ambiente in ('homologacao','producao')),
  serie int not null check (serie between 1 and 889),
  ultimo_numero int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, device_id, ambiente),
  unique (store_id, ambiente, serie)
);
alter table public.fiscal_contingencia_series enable row level security;
revoke all on public.fiscal_contingencia_series from anon, authenticated;
grant select, insert, update, delete on public.fiscal_contingencia_series to service_role;
notify pgrst, 'reload schema';
