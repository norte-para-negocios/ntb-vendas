-- 144: RPC pra incrementar uses_count de um cupom (2026-10-03)
CREATE OR REPLACE FUNCTION public.increment_coupon_uses(p_coupon_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
UPDATE discount_coupons SET uses_count = uses_count + 1 WHERE id = p_coupon_id;
END;
$$;