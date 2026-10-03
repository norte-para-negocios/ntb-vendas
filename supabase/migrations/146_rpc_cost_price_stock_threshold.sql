-- 146: atualiza RPCs de produto pra aceitar cost_price e stock_alert_threshold (2026-10-03)
-- CMV opcional + alerta de estoque baixo (migration 142)

CREATE OR REPLACE FUNCTION public.create_product_secure(
  p_store_id uuid, p_category_id uuid, p_name text, p_description text,
  p_price numeric, p_image_url text, p_prep_time_minutes integer,
  p_destination text, p_promo_price numeric DEFAULT NULL,
  p_featured boolean DEFAULT false, p_tags text[] DEFAULT '{}',
  p_ncm text DEFAULT NULL,
  p_cost_price numeric DEFAULT NULL,
  p_stock_alert_threshold integer DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_next_order int; v_id uuid;
begin
  select coalesce(max("order"), 0) + 1 into v_next_order from products where category_id = p_category_id;
  insert into products (store_id, category_id, name, description, price, image_url, prep_time_minutes, available, "order", destination, promo_price, featured, tags, ncm, cost_price, stock_alert_threshold)
  values (p_store_id, p_category_id, p_name, p_description, p_price, p_image_url, p_prep_time_minutes, true, v_next_order, coalesce(p_destination, 'kitchen'), p_promo_price, p_featured, coalesce(p_tags, '{}'), p_ncm, p_cost_price, p_stock_alert_threshold)
  returning id into v_id;
  return v_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.update_product_secure(
  p_product_id uuid, p_store_id uuid,
  p_name text DEFAULT NULL, p_description text DEFAULT NULL,
  p_price numeric DEFAULT NULL, p_category_id uuid DEFAULT NULL,
  p_image_url text DEFAULT NULL, p_prep_time_minutes integer DEFAULT NULL,
  p_destination text DEFAULT NULL, p_available boolean DEFAULT NULL,
  p_promo_price numeric DEFAULT NULL, p_clear_promo_price boolean DEFAULT false,
  p_featured boolean DEFAULT NULL, p_tags text[] DEFAULT NULL,
  p_ncm text DEFAULT NULL,
  p_cost_price numeric DEFAULT NULL, p_clear_cost_price boolean DEFAULT false,
  p_stock_alert_threshold integer DEFAULT NULL, p_clear_stock_alert_threshold boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
    ncm = coalesce(p_ncm, ncm),
    cost_price = case when p_clear_cost_price then null else coalesce(p_cost_price, cost_price) end,
    stock_alert_threshold = case when p_clear_stock_alert_threshold then null else coalesce(p_stock_alert_threshold, stock_alert_threshold) end
  where id = p_product_id and store_id = p_store_id;
end;
$$;