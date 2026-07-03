-- Avaliação pós-refeição (estrelas + comentário opcional). Dado não
-- sensível (diferente do certificado fiscal/PIN de mesa), então RLS
-- permissiva igual ao resto do schema (allow_all_anon), sem o padrão
-- write-only.
create table if not exists order_ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists order_ratings_store_id_idx on order_ratings(store_id, created_at desc);

alter table order_ratings enable row level security;
drop policy if exists "allow_all_anon" on order_ratings;
create policy "allow_all_anon" on order_ratings
  for all to anon, authenticated using (true) with check (true);
