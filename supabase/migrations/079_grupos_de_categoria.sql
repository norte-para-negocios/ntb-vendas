-- 079_grupos_de_categoria.sql
--
-- Grupo de categoria (2026-09-22, pedido direto): lojas com cardápio
-- grande (ex.: Sertão, 17+ categorias) agrupam categorias relacionadas —
-- "Bebidas" contendo Geladas/Vinhos/Drinks/..., "Pizzas" contendo as
-- variações de pizza. Opt-in: categoria sem grupo continua no primeiro
-- nível, exatamente como hoje. Ver
-- docs/superpowers/specs/2026-09-22-grupos-de-categoria-design.md.

create table category_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  "order" int not null default 0,
  created_at timestamptz not null default now()
);

alter table category_groups enable row level security;
create policy allow_all_anon on category_groups for all using (true) with check (true);

-- on delete set null (não cascade): apagar um grupo nunca apaga a
-- categoria, só desagrupa ela — mesmo princípio de `products.category_id`
-- desde a migration 001.
alter table categories add column if not exists group_id uuid references category_groups(id) on delete set null;

notify pgrst, 'reload schema';
