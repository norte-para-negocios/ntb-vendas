-- 149: posição da mesa na planta (floor plan, 2026-10-03). floor_x/floor_y já existem (142), em % do mapa (0-100).
-- Só gerente/dono edita no app; o servidor valida que a mesa é da loja e que x/y estão dentro do mapa.
CREATE OR REPLACE FUNCTION public.update_table_position_secure(p_store_id uuid, p_table_id uuid, p_x numeric, p_y numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if p_x is not null and (p_x < 0 or p_x > 100) then return false; end if;
  if p_y is not null and (p_y < 0 or p_y > 100) then return false; end if;
  update tables set floor_x = p_x, floor_y = p_y where id = p_table_id and store_id = p_store_id;
  return found;
end;
$$;
GRANT EXECUTE ON FUNCTION public.update_table_position_secure(uuid, uuid, numeric, numeric) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
