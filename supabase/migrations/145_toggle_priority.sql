-- 145: RPC pra toggle de prioridade de item no KDS (2026-10-03)
CREATE OR REPLACE FUNCTION public.toggle_order_item_priority(p_item_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_current boolean;
BEGIN
SELECT priority INTO v_current FROM order_items WHERE id = p_item_id;
IF NOT FOUND THEN RETURN false; END IF;
UPDATE order_items SET priority = NOT COALESCE(v_current, false) WHERE id = p_item_id;
-- Ping pra KDS atualizar via Realtime
INSERT INTO order_change_pings (store_id)
SELECT store_id FROM order_items WHERE id = p_item_id;
RETURN true;
END;
$$;