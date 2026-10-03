-- 142: schema para 7 features novas (2026-10-03)
-- CMV opcional, cupom de desconto, prioridade KDS, floor plan, alerta estoque

-- 1) CMV opcional (custo do produto pra calcular margem)
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price numeric(10,2);
ALTER TABLE products ADD CONSTRAINT products_cost_price_check
  CHECK (cost_price IS NULL OR cost_price >= 0);

-- 2) Alerta de estoque baixo (threshold por produto)
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_alert_threshold integer;
ALTER TABLE products ADD CONSTRAINT products_stock_alert_check
  CHECK (stock_alert_threshold IS NULL OR stock_alert_threshold > 0);

-- 3) Floor plan (posição da mesa no mapa)
ALTER TABLE tables ADD COLUMN IF NOT EXISTS floor_x numeric(6,2);
ALTER TABLE tables ADD COLUMN IF NOT EXISTS floor_y numeric(6,2);

-- 4) Prioridade no KDS
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS priority boolean NOT NULL DEFAULT false;

-- 5) Cupons de desconto
CREATE TABLE IF NOT EXISTS discount_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code text NOT NULL,
  type text NOT NULL CHECK (type IN ('percent', 'fixed')),
  value numeric(10,2) NOT NULL CHECK (value > 0),
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  min_order_value numeric(10,2),
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, code)
);
CREATE INDEX IF NOT EXISTS idx_discount_coupons_store ON discount_coupons(store_id, active);

-- 6) Registro de uso de cupom
CREATE TABLE IF NOT EXISTS coupon_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES discount_coupons(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  discount_amount numeric(10,2) NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon ON coupon_usages(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_order ON coupon_usages(order_id);

-- RLS allow_all_anon (mesmo padrão de products/categories)
ALTER TABLE discount_coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_all_anon_select ON discount_coupons FOR SELECT USING (true);
CREATE POLICY allow_all_anon_insert ON discount_coupons FOR INSERT WITH CHECK (true);
CREATE POLICY allow_all_anon_update ON discount_coupons FOR UPDATE USING (true);
CREATE POLICY allow_all_anon_delete ON discount_coupons FOR DELETE USING (true);

ALTER TABLE coupon_usages ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_all_anon_all ON coupon_usages FOR ALL USING (true) WITH CHECK (true);