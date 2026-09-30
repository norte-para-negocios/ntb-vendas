-- Local de estoque do Omie por destino de preparo (30/09, pedido do dono): em
-- Impressão → Locais de preparo, o lojista escolhe de qual local do Omie cada destino
-- (Cozinha, Bar, Pizzaria...) baixa. A integração com o Estoque manda esse local por item.
-- destino: 'kitchen' | 'bar' | 'setor:<print_sectors.id>'. Só o servidor (service role) lê/grava.
create table if not exists store_estoque_locais (
  store_id uuid not null references stores(id) on delete cascade,
  destino text not null,
  omie_local_codigo bigint not null,
  local_nome text,
  updated_at timestamptz not null default now(),
  primary key (store_id, destino)
);
alter table store_estoque_locais enable row level security;
revoke all on store_estoque_locais from anon, authenticated;
