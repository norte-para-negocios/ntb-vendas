-- Schema inicial do ntb-vendas (Cardápio Digital / Norte Vendas)
-- Reconstruído a partir de lib/api.ts e types/index.ts (não havia SQL versionado no repo).

create extension if not exists pgcrypto;

-- ─── system_admins ──────────────────────────────────────────────────────────
create table if not exists system_admins (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password text not null,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─── stores ──────────────────────────────────────────────────────────────────
create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  cnpj text,
  is_active boolean not null default true,
  contract_type text not null default 'balcao' check (contract_type in ('balcao', 'balcao_mesas')),
  contract_period_months integer not null default 12,
  activation_date date not null default current_date,
  config jsonb not null default '{"use_pin": true, "allow_client_open": true}'::jsonb,
  created_at timestamptz not null default now()
);

-- ─── store_users ─────────────────────────────────────────────────────────────
create table if not exists store_users (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  email text not null unique,
  password text not null,
  role text not null default 'waiter',
  must_change_password boolean not null default true,
  permissions jsonb not null default '{"tables": true, "counter": false, "kitchen": false, "bar": false, "menu": false, "admin": false}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_store_users_store_id on store_users(store_id);

-- ─── categories ──────────────────────────────────────────────────────────────
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  "order" integer not null default 0,
  icon text,
  created_at timestamptz not null default now()
);
create index if not exists idx_categories_store_id on categories(store_id);

-- ─── products ────────────────────────────────────────────────────────────────
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete set null,
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  description text default '',
  price numeric(10,2) not null default 0,
  image_url text,
  available boolean not null default true,
  prep_time_minutes integer not null default 15,
  "order" integer default 0,
  destination text not null default 'kitchen' check (destination in ('kitchen', 'bar')),
  created_at timestamptz not null default now()
);
create index if not exists idx_products_store_id on products(store_id);
create index if not exists idx_products_category_id on products(category_id);

-- ─── tables (mesas) ──────────────────────────────────────────────────────────
create table if not exists tables (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  number integer not null,
  pin text not null default lpad(floor(random() * 9000 + 1000)::text, 4, '0'),
  status text not null default 'available' check (status in ('available', 'occupied', 'waiting_bill', 'closed', 'blocked')),
  current_host_name text,
  guest_count integer not null default 0,
  waiter_requested boolean not null default false,
  service_fee_removed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_tables_store_id on tables(store_id);

-- ─── orders ──────────────────────────────────────────────────────────────────
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  table_id uuid references tables(id) on delete set null,
  store_id uuid not null references stores(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'preparing', 'ready', 'delivered', 'canceled')),
  order_type text not null default 'table' check (order_type in ('table', 'counter')),
  total numeric(10,2) not null default 0,
  customer_name text,
  payment_method text,
  payment_details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists idx_orders_store_id on orders(store_id);
create index if not exists idx_orders_table_id on orders(table_id);
create index if not exists idx_orders_status on orders(status);

-- ─── order_items ─────────────────────────────────────────────────────────────
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  quantity integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'preparing', 'ready', 'delivered', 'canceled')),
  notes text default '',
  price_at_time numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_items_order_id on order_items(order_id);
create index if not exists idx_order_items_product_id on order_items(product_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- O app não usa Supabase Auth: lojista, cozinha e admin autenticam contra as
-- próprias tabelas (system_admins / store_users) e operam tudo com a anon key.
-- Por isso as policies liberam full access para anon/authenticated, igual ao
-- comportamento que já existia no projeto Supabase antigo.
alter table system_admins enable row level security;
alter table stores enable row level security;
alter table store_users enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table tables enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array['system_admins','stores','store_users','categories','products','tables','orders','order_items'])
  loop
    execute format('drop policy if exists "allow_all_anon" on %I;', t);
    execute format('create policy "allow_all_anon" on %I for all to anon, authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- ─── Realtime ────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orders') then
    alter publication supabase_realtime add table orders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'order_items') then
    alter publication supabase_realtime add table order_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tables') then
    alter publication supabase_realtime add table tables;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'stores') then
    alter publication supabase_realtime add table stores;
  end if;
end $$;
