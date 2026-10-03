-- 143: cupom de desconto vinculado ao pedido (2026-10-03)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES discount_coupons(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_discount numeric(10,2) DEFAULT 0;
ALTER TABLE orders ADD CONSTRAINT orders_coupon_discount_check
CHECK (coupon_discount >= 0);