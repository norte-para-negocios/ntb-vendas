-- Seed inicial: mesma loja/credenciais de demo que já existiam no modo mock,
-- para manter os logins (demo@bistro.com / cozinha@bistro.com) funcionando.

insert into system_admins (username, password, must_change_password)
values ('admin', 'admin123', false)
on conflict (username) do nothing;

with novo_store as (
  insert into stores (name, slug, cnpj, is_active, contract_type, contract_period_months, config)
  values (
    'Bistrô Demo', 'bistro', '00.000.000/0001-00', true, 'balcao_mesas', 12,
    '{"use_pin": false, "allow_client_open": true, "require_pin_for_open": false, "charge_service_fee": true}'::jsonb
  )
  on conflict (slug) do update set name = excluded.name
  returning id
)
select id from novo_store;

-- store_users
insert into store_users (store_id, name, email, password, role, must_change_password, permissions)
select s.id, 'Demo Gerente', 'demo@bistro.com', 'demo123', 'owner', false,
  '{"tables": true, "counter": true, "kitchen": true, "bar": true, "menu": true, "admin": true}'::jsonb
from stores s where s.slug = 'bistro'
on conflict (email) do nothing;

insert into store_users (store_id, name, email, password, role, must_change_password, permissions)
select s.id, 'Ana Cozinha', 'cozinha@bistro.com', 'coz123', 'kitchen', false,
  '{"tables": false, "counter": false, "kitchen": true, "bar": false, "menu": false, "admin": false}'::jsonb
from stores s where s.slug = 'bistro'
on conflict (email) do nothing;

-- categorias
insert into categories (store_id, name, "order")
select s.id, c.name, c.ord
from stores s, (values ('Entradas', 0), ('Pratos Principais', 1), ('Bebidas', 2), ('Sobremesas', 3)) as c(name, ord)
where s.slug = 'bistro'
on conflict do nothing;

-- produtos
insert into products (store_id, category_id, name, description, price, available, prep_time_minutes, "order", destination)
select s.id, cat.id, p.name, p.description, p.price, true, p.prep, p.ord, p.dest
from stores s
join categories cat on cat.store_id = s.id
join (values
  ('Entradas', 'Bruschetta', 'Pão torrado com tomate e manjericão', 18, 10, 1, 'kitchen'),
  ('Entradas', 'Carpaccio', 'Carne fatiada com alcaparras e parmesão', 32, 8, 2, 'kitchen'),
  ('Pratos Principais', 'Risoto de Funghi', 'Arroz arbóreo cremoso com cogumelos frescos', 58, 25, 1, 'kitchen'),
  ('Pratos Principais', 'Filé ao Molho Madeira', 'Filé mignon grelhado com arroz e batata', 72, 20, 2, 'kitchen'),
  ('Pratos Principais', 'Salmão Grelhado', 'Salmão com legumes salteados na manteiga', 65, 18, 3, 'kitchen'),
  ('Bebidas', 'Água Mineral 500ml', 'Com ou sem gás', 6, 1, 1, 'bar'),
  ('Bebidas', 'Suco de Laranja', 'Natural, 300ml', 12, 5, 2, 'bar'),
  ('Bebidas', 'Caipirinha', 'Limão, cachaça artesanal e gelo', 22, 5, 3, 'bar'),
  ('Bebidas', 'Vinho Tinto Taça', 'Malbec argentino, 150ml', 28, 2, 4, 'bar'),
  ('Sobremesas', 'Petit Gâteau', 'Bolinho quente com sorvete de baunilha', 24, 12, 1, 'kitchen'),
  ('Sobremesas', 'Tiramisù', 'Clássico italiano com mascarpone e café', 22, 5, 2, 'kitchen')
) as p(cat_name, name, description, price, prep, ord, dest) on p.cat_name = cat.name
where s.slug = 'bistro'
on conflict do nothing;

-- mesas
insert into tables (store_id, number, pin, status, guest_count)
select s.id, n, lpad((n * 1111)::text, 4, '0'), 'available', 0
from stores s, generate_series(1, 8) as n
where s.slug = 'bistro'
on conflict do nothing;
