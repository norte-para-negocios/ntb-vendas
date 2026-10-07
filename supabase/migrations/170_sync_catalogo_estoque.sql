-- 170 — Sincronização automática do catálogo com o Norte Estoque (lojas stock_mode='proprio').
-- Aditiva. Lojas 'omie' e 'nenhum' não mudam. Modelo e regras: ntb-estoque/docs/superpowers/specs/2026-10-06-sync-catalogo-design.md
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d ntb_vendas < 170_sync_catalogo_estoque.sql
-- Depende de: 168 (stores.stock_mode), 027 (store_ntb_estoque_secrets).

-- 1) Colunas de ligação e de data de alteração ------------------------------------------------------------
alter table public.products        add column if not exists estoque_pai_codigo text;           -- produto mãe: código da mãe no Estoque (omie_codigo fica nulo: evita baixa em dobro)
alter table public.products        add column if not exists estoque_sync_at timestamptz;
alter table public.products        add column if not exists updated_at timestamptz not null default now();
alter table public.categories      add column if not exists estoque_grupo_id bigint;
alter table public.categories      add column if not exists updated_at timestamptz not null default now();
alter table public.category_groups add column if not exists estoque_grupo_id bigint;
alter table public.category_groups add column if not exists updated_at timestamptz not null default now();
alter table public.product_options add column if not exists estoque_preco numeric;             -- preço absoluto da variação (o acréscimo é calculado sobre o preço da mãe)

create unique index if not exists products_estoque_pai_uq    on public.products (store_id, estoque_pai_codigo) where estoque_pai_codigo is not null;
create unique index if not exists categories_estoque_uq      on public.categories (store_id, estoque_grupo_id) where estoque_grupo_id is not null;
create unique index if not exists category_groups_estoque_uq on public.category_groups (store_id, estoque_grupo_id) where estoque_grupo_id is not null;

-- updated_at: edição normal marca agora; escrita vinda do Estoque (sync_skip) preserva a data que a função definiu.
create or replace function public.trg_touch_updated_at() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('ntb.sync_skip', true), '') <> '1' then new.updated_at := now(); end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['products', 'categories', 'category_groups'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.trg_touch_updated_at()', t);
  end loop;
end $$;

-- 2) Outbox ---------------------------------------------------------------------------------------------------
create table if not exists public.sync_estoque_outbox (
  id                bigint generated always as identity primary key,
  store_id          uuid not null references public.stores(id) on delete cascade,
  entidade          text not null check (entidade in ('produto', 'categoria', 'grupo')),
  ref               text not null,                                      -- products.id | categories.id | category_groups.id
  operacao          text not null default 'upsert' check (operacao in ('upsert', 'delete')),
  payload           jsonb,                                              -- só em delete (a linha já não existe)
  status            text not null default 'pending' check (status in ('pending', 'ok', 'erro')),
  tentativas        int not null default 0,
  erro              text,
  proxima_tentativa timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists sync_estoque_outbox_pendente_uq on public.sync_estoque_outbox (store_id, entidade, ref) where status = 'pending';
create index if not exists sync_estoque_outbox_fila on public.sync_estoque_outbox (status, proxima_tentativa);

create table if not exists public.sync_estoque_divergencias (
  id           bigint generated always as identity primary key,
  store_id     uuid not null references public.stores(id) on delete cascade,
  entidade     text not null,
  ref          text not null,
  tipo         text not null,
  detalhe      text,
  detectado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create unique index if not exists sync_estoque_diverg_aberta_uq on public.sync_estoque_divergencias (store_id, entidade, ref, tipo) where resolvido_em is null;

-- só funções security definer e o servidor (service role) mexem; ninguém lê pela chave pública
alter table public.sync_estoque_outbox enable row level security;
alter table public.sync_estoque_divergencias enable row level security;
revoke all on public.sync_estoque_outbox, public.sync_estoque_divergencias from anon, authenticated;
grant all on public.sync_estoque_outbox, public.sync_estoque_divergencias to service_role;

-- 3) Variação: grupo de opção que representa as variações de um produto mãe ----------------------------------------
-- "Variação" por nome, ou grupo de escolha única obrigatória em que TODAS as opções têm código do estoque.
create or replace function public.grupo_variacao_do_produto(p_product uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select g.id
    from product_option_groups g
   where g.product_id = p_product and g.type = 'single' and g.required
     and (g.name = 'Variação'
          or (exists (select 1 from product_options o where o.group_id = g.id)
              and not exists (select 1 from product_options o where o.group_id = g.id and coalesce(o.omie_codigo, '') = '')))
   order by (g.name = 'Variação') desc, g."order", g.created_at
   limit 1
$$;

-- 4) Gatilho do outbox -------------------------------------------------------------------------------------------
create or replace function public.trg_sync_estoque_outbox() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_ent text; v_ref text; v_op text := 'upsert'; v_payload jsonb; r record; v_prod uuid;
begin
  if coalesce(current_setting('ntb.sync_skip', true), '') = '1' then return null; end if;
  if tg_op = 'DELETE' then r := old; v_op := 'delete'; else r := new; end if;

  if tg_table_name = 'products' then
    v_store := r.store_id; v_ent := 'produto'; v_ref := r.id::text;
    if tg_op = 'DELETE' then v_payload := jsonb_build_object('codigo', r.omie_codigo, 'pai_codigo', r.estoque_pai_codigo); end if;
  elsif tg_table_name = 'categories' then
    v_store := r.store_id; v_ent := 'categoria'; v_ref := r.id::text;
  elsif tg_table_name = 'category_groups' then
    v_store := r.store_id; v_ent := 'grupo'; v_ref := r.id::text;
  elsif tg_table_name = 'product_option_groups' then
    v_prod := r.product_id; v_ent := 'produto'; v_ref := v_prod::text; v_op := 'upsert';
    select store_id into v_store from products where id = v_prod;
  elsif tg_table_name = 'product_options' then
    select g.product_id into v_prod from product_option_groups g where g.id = r.group_id;
    if v_prod is null then return null; end if;
    v_ent := 'produto'; v_ref := v_prod::text; v_op := 'upsert';
    select store_id into v_store from products where id = v_prod;
  else
    return null;
  end if;
  if v_store is null then return null; end if;
  if not exists (select 1 from stores s join store_ntb_estoque_secrets k on k.store_id = s.id and k.ativo
                  where s.id = v_store and s.stock_mode = 'proprio') then return null; end if;

  insert into sync_estoque_outbox (store_id, entidade, ref, operacao, payload) values (v_store, v_ent, v_ref, v_op, v_payload)
  on conflict (store_id, entidade, ref) where status = 'pending'
  do update set operacao = excluded.operacao, payload = coalesce(excluded.payload, sync_estoque_outbox.payload), updated_at = now(),
                proxima_tentativa = least(sync_estoque_outbox.proxima_tentativa, now());
  return null;
exception when others then
  return null;     -- a sincronização nunca derruba o cadastro nem a venda
end $$;
do $$ declare t text; begin
  foreach t in array array['products', 'categories', 'category_groups', 'product_option_groups', 'product_options'] loop
    execute format('drop trigger if exists sync_estoque_outbox on public.%I', t);
    execute format('create trigger sync_estoque_outbox after insert or update or delete on public.%I for each row execute function public.trg_sync_estoque_outbox()', t);
  end loop;
end $$;

-- 5) Catálogo do Vendas no formato do Estoque ----------------------------------------------------------------------
-- Produto mãe (sem omie_codigo e com grupo de variação) vira {mae:true} + uma variação por opção; produto simples vira 1 item.
-- Produto-taxa (fee_type) não entra: é cobrança, não item de estoque.
create or replace function public.catalogo_para_estoque(p_store uuid, p_produtos uuid[] default null, p_categorias uuid[] default null, p_grupos uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r_g jsonb := '[]'::jsonb; r_p jsonb := '[]'::jsonb; x record; op record; v_gv uuid; v_cat uuid[];
begin
  -- grupos: categorias e grupos de categoria citados, mais as categorias dos produtos
  for x in select id, name, "order", updated_at from category_groups
            where store_id = p_store and (p_grupos is null or id = any(p_grupos) or id in (select group_id from categories where id = any(coalesce(p_categorias, '{}'::uuid[])) and group_id is not null))
            order by "order", name loop
    r_g := r_g || jsonb_build_object('vendas_ref', x.id, 'nome', x.name, 'pai_vendas_ref', null, 'ordem', x."order", 'ativo', true, 'updated_at', x.updated_at);
  end loop;
  select array_agg(distinct category_id) into v_cat from products where store_id = p_store and category_id is not null and (p_produtos is null or id = any(p_produtos));
  for x in select c.id, c.name, c."order", c.group_id, c.updated_at, cg.name as gname, cg."order" as gordem, cg.updated_at as gupd, cg.id as gid
             from categories c left join category_groups cg on cg.id = c.group_id
            where c.store_id = p_store and (p_categorias is null and p_grupos is null and p_produtos is null
                   or c.id = any(coalesce(p_categorias, '{}'::uuid[])) or c.id = any(coalesce(v_cat, '{}'::uuid[]))
                   or c.group_id = any(coalesce(p_grupos, '{}'::uuid[])))
            order by c."order", c.name loop
    if x.group_id is not null and not (r_g @> jsonb_build_array(jsonb_build_object('vendas_ref', x.group_id))) then
      r_g := r_g || jsonb_build_object('vendas_ref', x.group_id, 'nome', x.gname, 'pai_vendas_ref', null, 'ordem', x.gordem, 'ativo', true, 'updated_at', x.gupd);
    end if;
    r_g := r_g || jsonb_build_object('vendas_ref', x.id, 'nome', x.name, 'pai_vendas_ref', x.group_id, 'ordem', x."order", 'ativo', true, 'updated_at', x.updated_at);
  end loop;

  for x in select p.* from products p
            where p.store_id = p_store and (p_produtos is null or p.id = any(p_produtos)) and coalesce(btrim(p.name), '') <> ''
              and p.fee_type is null
            order by p.created_at loop
    v_gv := case when coalesce(x.omie_codigo, '') = '' then grupo_variacao_do_produto(x.id) else null end;
    if v_gv is not null then
      r_p := r_p || jsonb_build_object('vendas_ref', x.id, 'codigo', x.estoque_pai_codigo, 'nome', x.name, 'preco', x.price, 'ativo', x.available,
               'mae', true, 'grupo_vendas_ref', x.category_id, 'atributos', '{}'::jsonb, 'tipo_item', '04', 'ncm', x.ncm, 'updated_at', x.updated_at);
      for op in select po.*, pg.name as gnome from product_options po join product_option_groups pg on pg.id = po.group_id where po.group_id = v_gv order by po."order", po.created_at loop
        r_p := r_p || jsonb_build_object('vendas_ref', op.id, 'codigo', op.omie_codigo, 'nome', x.name || ' - ' || op.name,
               'preco', coalesce(op.estoque_preco, x.price + op.price_delta), 'ativo', op.available, 'mae', false,
               'pai_vendas_ref', x.id, 'pai_codigo', x.estoque_pai_codigo, 'grupo_vendas_ref', x.category_id,
               'atributos', jsonb_build_object(op.gnome, op.name), 'tipo_item', '04', 'ncm', x.ncm, 'updated_at', x.updated_at);
      end loop;
    else
      r_p := r_p || jsonb_build_object('vendas_ref', x.id, 'codigo', nullif(x.omie_codigo, ''), 'nome', x.name, 'preco', x.price, 'ativo', x.available,
               'mae', false, 'grupo_vendas_ref', x.category_id, 'atributos', '{}'::jsonb, 'tipo_item', '04', 'ncm', x.ncm, 'updated_at', x.updated_at);
    end if;
  end loop;
  return jsonb_build_object('grupos', r_g, 'produtos', r_p);
end $$;

-- 6) Aplicar catálogo vindo do Estoque (idempotente, sem eco) ---------------------------------------------------------
-- payload (formato do Estoque): grupos:[{estoque_id, vendas_ref, nome, pai_estoque_id, ordem, ativo, updated_at}],
--   produtos:[{codigo, vendas_ref, nome, preco, ativo, mae, pai_codigo, grupo_estoque_id, atributos, unidade, tipo_item, ncm, updated_at}]
-- Regras: preço de venda = o Vendas manda (produto existente nunca muda de preço aqui); código/unidade/tipo/NCM = o Estoque manda;
-- nome e grupo = vence o updated_at mais novo; produto novo nasce INDISPONÍVEL até ter categoria e preço; inativar propaga, reativar não.
create or replace function public.aplicar_catalogo_estoque(p_store uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; g jsonb; p jsonb; v_ts timestamptz; v_id uuid; v_gid uuid; v_eid bigint; v_pai bigint; v_nome text;
  r_g jsonb := '[]'::jsonb; r_p jsonb := '[]'::jsonb; v_cat uuid; v_ex products%rowtype; v_mae products%rowtype; v_grp uuid; v_opt product_options%rowtype;
  v_valor text; v_preco numeric; v_cod text; v_ativo boolean; v_atual timestamptz; v_gmap jsonb := '{}'::jsonb; v_prof int; v_chave text;
begin
  select stock_mode into v_modo from stores where id = p_store;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_store using errcode = '22023'; end if;
  perform set_config('ntb.sync_skip', '1', true);

  -- mapa id do Estoque -> pai do Estoque (para achar a categoria de grupos mais fundos)
  for g in select * from jsonb_array_elements(coalesce(p_payload -> 'grupos', '[]'::jsonb)) loop
    v_gmap := v_gmap || jsonb_build_object(g ->> 'estoque_id', coalesce(g ->> 'pai_estoque_id', ''));
  end loop;

  for g in select * from jsonb_array_elements(coalesce(p_payload -> 'grupos', '[]'::jsonb)) loop
    v_eid := (g ->> 'estoque_id')::bigint; v_nome := btrim(g ->> 'nome'); v_ts := coalesce((g ->> 'updated_at')::timestamptz, now());
    if v_nome is null or v_nome = '' then continue; end if;
    v_pai := nullif(g ->> 'pai_estoque_id', '')::bigint;
    v_id := null;
    if v_pai is null then
      -- raiz: grupo de categorias (ou, se o Vendas já a tinha como categoria sem grupo, a mesma categoria)
      select id into v_id from category_groups where store_id = p_store and estoque_grupo_id = v_eid;
      if v_id is null and nullif(g ->> 'vendas_ref', '') is not null then
        select id into v_id from category_groups where store_id = p_store and id = (g ->> 'vendas_ref')::uuid;
        if v_id is not null then update category_groups set estoque_grupo_id = v_eid where id = v_id; end if;
        if v_id is null then
          select id into v_id from categories where store_id = p_store and id = (g ->> 'vendas_ref')::uuid;
          if v_id is not null then update categories set estoque_grupo_id = v_eid where id = v_id and estoque_grupo_id is null; end if;
        end if;
      end if;
      if v_id is null then
        select id into v_id from category_groups where store_id = p_store and estoque_grupo_id is null and lower(name) = lower(v_nome) limit 1;
        if v_id is not null then update category_groups set estoque_grupo_id = v_eid where id = v_id; end if;
      end if;
      if v_id is null then
        insert into category_groups (store_id, name, "order", estoque_grupo_id, updated_at)
        values (p_store, v_nome, coalesce((g ->> 'ordem')::int, 0), v_eid, v_ts) returning id into v_id;
      else
        select updated_at into v_atual from category_groups where id = v_id;
        if v_atual is not null and v_ts > v_atual then update category_groups set name = v_nome, "order" = coalesce((g ->> 'ordem')::int, "order"), updated_at = v_ts where id = v_id; end if;
      end if;
    else
      -- só o 2º nível vira categoria; níveis mais fundos ficam no Estoque
      select id into v_gid from category_groups where store_id = p_store and estoque_grupo_id = v_pai;
      if v_gid is null then continue; end if;
      select id into v_id from categories where store_id = p_store and estoque_grupo_id = v_eid;
      if v_id is null and nullif(g ->> 'vendas_ref', '') is not null then
        select id into v_id from categories where store_id = p_store and id = (g ->> 'vendas_ref')::uuid;
        if v_id is not null then update categories set estoque_grupo_id = v_eid where id = v_id and estoque_grupo_id is null; end if;
      end if;
      if v_id is null then
        select id into v_id from categories where store_id = p_store and estoque_grupo_id is null and group_id = v_gid and lower(name) = lower(v_nome) limit 1;
        if v_id is not null then update categories set estoque_grupo_id = v_eid where id = v_id; end if;
      end if;
      if v_id is null then
        insert into categories (store_id, name, "order", group_id, estoque_grupo_id, updated_at)
        values (p_store, v_nome, coalesce((g ->> 'ordem')::int, 0), v_gid, v_eid, v_ts) returning id into v_id;
      else
        select updated_at into v_atual from categories where id = v_id;
        if v_atual is not null and v_ts > v_atual then update categories set name = v_nome, "order" = coalesce((g ->> 'ordem')::int, "order"), group_id = v_gid, updated_at = v_ts where id = v_id; end if;
      end if;
    end if;
    r_g := r_g || jsonb_build_object('estoque_id', v_eid, 'vendas_ref', v_id);
  end loop;

  for p in select * from jsonb_array_elements(coalesce(p_payload -> 'produtos', '[]'::jsonb)) loop
    v_ts := coalesce((p ->> 'updated_at')::timestamptz, now());
    v_nome := btrim(p ->> 'nome'); v_cod := nullif(p ->> 'codigo', ''); v_preco := coalesce((p ->> 'preco')::numeric, 0);
    v_ativo := coalesce((p ->> 'ativo')::boolean, true);

    -- categoria do produto: sobe pela árvore do Estoque até achar categoria (2º nível) ou grupo raiz (categoria implícita)
    v_cat := null; v_eid := nullif(p ->> 'grupo_estoque_id', '')::bigint; v_prof := 0;
    while v_eid is not null and v_cat is null and v_prof < 6 loop
      v_prof := v_prof + 1;
      select id into v_cat from categories where store_id = p_store and estoque_grupo_id = v_eid;
      if v_cat is null then
        select id, name into v_gid, v_chave from category_groups where store_id = p_store and estoque_grupo_id = v_eid;
        if v_gid is not null then
          select id into v_cat from categories where store_id = p_store and group_id = v_gid and lower(name) = lower(v_chave) limit 1;
          if v_cat is null then
            insert into categories (store_id, name, "order", group_id, estoque_grupo_id) values (p_store, v_chave, 0, v_gid, v_eid) returning id into v_cat;
          end if;
        end if;
      end if;
      if v_cat is null then v_eid := nullif(v_gmap ->> v_eid::text, '')::bigint; end if;
    end loop;

    if nullif(p ->> 'pai_codigo', '') is not null or (coalesce((p ->> 'mae')::boolean, false) = false and nullif(p ->> 'pai_codigo', '') is not null) then
      -- variação: opção do grupo de variação da mãe
      select * into v_mae from products where store_id = p_store and estoque_pai_codigo = p ->> 'pai_codigo';
      if v_mae.id is null then continue; end if;
      v_grp := grupo_variacao_do_produto(v_mae.id);
      if v_grp is null then
        select id into v_grp from product_option_groups where product_id = v_mae.id and name = 'Variação' limit 1;
        if v_grp is null then
          insert into product_option_groups (product_id, name, type, required, "order", price_rule) values (v_mae.id, 'Variação', 'single', true, 0, 'sum') returning id into v_grp;
        end if;
      end if;
      select * into v_opt from product_options where group_id = v_grp and omie_codigo = v_cod;
      v_valor := coalesce((select value from jsonb_each_text(coalesce(p -> 'atributos', '{}'::jsonb)) limit 1), v_nome);
      if v_opt.id is null then
        if v_preco < v_mae.price then
          update product_options set price_delta = price_delta + (v_mae.price - v_preco) where group_id = v_grp;
          update products set price = v_preco where id = v_mae.id;
          v_mae.price := v_preco;
        end if;
        insert into product_options (group_id, name, price_delta, "order", available, omie_codigo, estoque_preco)
        values (v_grp, v_valor, greatest(0, v_preco - v_mae.price), coalesce((select max("order") + 1 from product_options where group_id = v_grp), 0), v_ativo, v_cod, v_preco)
        returning * into v_opt;
      else
        if not v_ativo and v_opt.available then update product_options set available = false where id = v_opt.id; end if;
      end if;
      update products set estoque_sync_at = now() where id = v_mae.id;
      r_p := r_p || jsonb_build_object('codigo', v_cod, 'vendas_ref', v_opt.id);

    elsif coalesce((p ->> 'mae')::boolean, false) then
      select * into v_ex from products where store_id = p_store and (estoque_pai_codigo = v_cod or id = nullif(p ->> 'vendas_ref', '')::uuid) limit 1;
      if v_ex.id is null then
        if v_nome is null or v_nome = '' then continue; end if;
        insert into products (store_id, category_id, name, price, available, estoque_pai_codigo, ncm, estoque_sync_at, updated_at)
        values (p_store, v_cat, v_nome, v_preco, false, v_cod, nullif(p ->> 'ncm', ''), now(), v_ts) returning * into v_ex;
      else
        if v_ex.estoque_pai_codigo is null and v_cod is not null and coalesce(v_ex.omie_codigo, '') = '' then update products set estoque_pai_codigo = v_cod where id = v_ex.id; end if;
        if v_ts > v_ex.updated_at then
          update products set name = coalesce(nullif(v_nome, ''), name), category_id = coalesce(v_cat, category_id), updated_at = v_ts where id = v_ex.id;
        end if;
        if not v_ativo and v_ex.available then update products set available = false where id = v_ex.id; end if;
        update products set estoque_sync_at = now() where id = v_ex.id;
      end if;
      r_p := r_p || jsonb_build_object('codigo', v_cod, 'vendas_ref', v_ex.id);

    else
      select * into v_ex from products where store_id = p_store and ((v_cod is not null and omie_codigo = v_cod) or id = nullif(p ->> 'vendas_ref', '')::uuid) limit 1;
      if v_ex.id is null then
        if v_nome is null or v_nome = '' or v_cod is null then continue; end if;
        insert into products (store_id, category_id, name, price, available, omie_codigo, ncm, estoque_sync_at, updated_at)
        values (p_store, v_cat, v_nome, v_preco, false, v_cod, nullif(p ->> 'ncm', ''), now(), v_ts) returning * into v_ex;
      else
        if coalesce(v_ex.omie_codigo, '') = '' and v_cod is not null then update products set omie_codigo = v_cod where id = v_ex.id; end if;
        if v_ts > v_ex.updated_at then
          update products set name = coalesce(nullif(v_nome, ''), name), category_id = coalesce(v_cat, category_id), updated_at = v_ts where id = v_ex.id;
        end if;
        if not v_ativo and v_ex.available then update products set available = false where id = v_ex.id; end if;
        if v_ex.ncm is null and nullif(p ->> 'ncm', '') is not null then update products set ncm = p ->> 'ncm' where id = v_ex.id; end if;
        update products set estoque_sync_at = now() where id = v_ex.id;
      end if;
      r_p := r_p || jsonb_build_object('codigo', v_cod, 'vendas_ref', v_ex.id);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'grupos', r_g, 'produtos', r_p);
end $$;

-- Grava no Vendas os códigos que o Estoque criou (produto novo no Vendas ganha código por tipo; mãe ganha o código da mãe).
create or replace function public.aplicar_mapa_estoque(p_store uuid, p_mapa jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m jsonb; v_id uuid; v_cod text; v_opt uuid; v_grp uuid;
begin
  perform set_config('ntb.sync_skip', '1', true);
  for m in select * from jsonb_array_elements(coalesce(p_mapa -> 'produtos', '[]'::jsonb)) loop
    v_cod := nullif(m ->> 'codigo', '');
    if v_cod is null or nullif(m ->> 'vendas_ref', '') is null then continue; end if;
    v_id := (m ->> 'vendas_ref')::uuid;
    if exists (select 1 from products where id = v_id and store_id = p_store) then
      if grupo_variacao_do_produto(v_id) is not null and coalesce((select omie_codigo from products where id = v_id), '') = '' then
        update products set estoque_pai_codigo = coalesce(estoque_pai_codigo, v_cod), estoque_sync_at = now() where id = v_id;
      else
        update products set omie_codigo = coalesce(nullif(omie_codigo, ''), v_cod), estoque_sync_at = now() where id = v_id;
      end if;
    else
      update product_options set omie_codigo = coalesce(nullif(omie_codigo, ''), v_cod)
       where id = v_id and group_id in (select g.id from product_option_groups g join products p on p.id = g.product_id where p.store_id = p_store);
    end if;
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_mapa -> 'grupos', '[]'::jsonb)) loop
    if nullif(m ->> 'vendas_ref', '') is null then continue; end if;
    v_id := (m ->> 'vendas_ref')::uuid;
    update category_groups set estoque_grupo_id = (m ->> 'estoque_id')::bigint where id = v_id and store_id = p_store and estoque_grupo_id is null;
    update categories      set estoque_grupo_id = (m ->> 'estoque_id')::bigint where id = v_id and store_id = p_store and estoque_grupo_id is null;
  end loop;
  -- carimba o que acabou de ser entregue (a reconciliação não reenvia)
  update products set estoque_sync_at = now() where store_id = p_store and id = any(select jsonb_array_elements_text(coalesce(p_mapa -> 'entregues', '[]'::jsonb))::uuid);
end $$;


-- Reconciliação: enfileira o que o Estoque ainda não recebeu ou que mudou depois da última entrega.
create or replace function public.enfileirar_catalogo_pendente(p_store uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  insert into sync_estoque_outbox (store_id, entidade, ref, operacao)
  select p_store, 'produto', id::text, 'upsert' from products
   where store_id = p_store and fee_type is null and coalesce(btrim(name), '') <> ''
     and (estoque_sync_at is null or updated_at > estoque_sync_at)
  on conflict (store_id, entidade, ref) where status = 'pending' do nothing;
  get diagnostics k = row_count; n := n + k;
  insert into sync_estoque_outbox (store_id, entidade, ref, operacao)
  select p_store, 'categoria', id::text, 'upsert' from categories where store_id = p_store and estoque_grupo_id is null
  on conflict (store_id, entidade, ref) where status = 'pending' do nothing;
  get diagnostics k = row_count; n := n + k;
  insert into sync_estoque_outbox (store_id, entidade, ref, operacao)
  select p_store, 'grupo', id::text, 'upsert' from category_groups where store_id = p_store and estoque_grupo_id is null
  on conflict (store_id, entidade, ref) where status = 'pending' do nothing;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'enfileirar_catalogo_pendente(uuid)', 'grupo_variacao_do_produto(uuid)', 'catalogo_para_estoque(uuid,uuid[],uuid[],uuid[])',
    'aplicar_catalogo_estoque(uuid,jsonb)', 'aplicar_mapa_estoque(uuid,jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
