-- NCM em create_product_secure/update_product_secure (migration 032 so'
-- adicionou a coluna products.ncm, sem tocar nas RPCs). Recria as duas
-- functions (definidas pela ultima vez na migration 021 — nenhuma migration
-- posterior alterou a assinatura delas) com p_ncm text default null no FIM
-- da lista de parametros (Postgres nao permite inserir parametro no meio de
-- uma function existente sem quebrar quem ja chama por posição/nome com
-- default), pra nao quebrar nenhuma chamada existente.
--
-- Achado real ao aplicar: `create or replace function` NAO substitui a
-- function antiga quando a lista de parametros muda de tamanho — Postgres
-- identifica uma function por (nome, tipos dos parametros), entao adicionar
-- p_ncm no fim (mesmo com default) cria um OVERLOAD novo em vez de
-- substituir, deixando as duas versões (11/14 e 12/15 args) coexistindo.
-- `drop function` explicito das assinaturas antigas primeiro evita esse
-- overload fantasma — nenhum client deste projeto chama essas RPCs por
-- posição (sempre nomeado, via supabase.rpc(nome, {objeto})), então dropar
-- a assinatura antiga não quebra nada que já esteja em produção.
drop function if exists public.create_product_secure(uuid, uuid, text, text, numeric, text, int, text, numeric, boolean, text[]);
drop function if exists public.update_product_secure(uuid, uuid, text, text, numeric, uuid, text, int, text, boolean, numeric, boolean, boolean, text[]);

create or replace function public.create_product_secure(
  p_store_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_image_url text,
  p_prep_time_minutes int,
  p_destination text,
  p_promo_price numeric default null,
  p_featured boolean default false,
  p_tags text[] default '{}',
  p_ncm text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_order int;
  v_id uuid;
begin
  select coalesce(max("order"), 0) + 1 into v_next_order from products where category_id = p_category_id;

  insert into products (store_id, category_id, name, description, price, image_url, prep_time_minutes, available, "order", destination, promo_price, featured, tags, ncm)
  values (p_store_id, p_category_id, p_name, p_description, p_price, p_image_url, p_prep_time_minutes, true, v_next_order, coalesce(p_destination, 'kitchen'), p_promo_price, p_featured, coalesce(p_tags, '{}'), p_ncm)
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.create_product_secure(uuid, uuid, text, text, numeric, text, int, text, numeric, boolean, text[], text) to anon, authenticated;

-- update_product_secure: parametros nullable = "nao mudar esse campo" (nao
-- da pra distinguir NULL de "nao enviado" numa RPC com params nomeados, mas
-- nenhum desses campos e' legitimamente setado pra NULL pelo client hoje,
-- exceto promo_price -- por isso um flag separado p_clear_promo_price).
-- p_ncm segue o mesmo coalesce dos demais campos opcionais (nao ganhou flag
-- de "limpar" proprio — igual a nome/descricao/etc., nenhum client hoje
-- precisa apagar o NCM de volta pra null explicitamente).
create or replace function public.update_product_secure(
  p_product_id uuid,
  p_store_id uuid,
  p_name text default null,
  p_description text default null,
  p_price numeric default null,
  p_category_id uuid default null,
  p_image_url text default null,
  p_prep_time_minutes int default null,
  p_destination text default null,
  p_available boolean default null,
  p_promo_price numeric default null,
  p_clear_promo_price boolean default false,
  p_featured boolean default null,
  p_tags text[] default null,
  p_ncm text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from products where id = p_product_id and store_id = p_store_id) then
    raise exception 'Produto inválido para esta loja.';
  end if;

  update products set
    name = coalesce(p_name, name),
    description = coalesce(p_description, description),
    price = coalesce(p_price, price),
    category_id = coalesce(p_category_id, category_id),
    image_url = coalesce(p_image_url, image_url),
    prep_time_minutes = coalesce(p_prep_time_minutes, prep_time_minutes),
    destination = coalesce(p_destination, destination),
    available = coalesce(p_available, available),
    promo_price = case when p_clear_promo_price then null else coalesce(p_promo_price, promo_price) end,
    featured = coalesce(p_featured, featured),
    tags = coalesce(p_tags, tags),
    ncm = coalesce(p_ncm, ncm)
  where id = p_product_id and store_id = p_store_id;
end;
$$;
grant execute on function public.update_product_secure(uuid, uuid, text, text, numeric, uuid, text, int, text, boolean, numeric, boolean, boolean, text[], text) to anon, authenticated;
