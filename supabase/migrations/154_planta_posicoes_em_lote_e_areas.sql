-- 154: planta de mesas — gravação em lote e áreas (Salão, Varanda…). Aditiva: não altera nada que já existe.
-- get_tables_secure devolve row_to_json(t) (030), então a coluna nova chega ao app sem mexer na função.
ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS area text;

-- p_items: array de {id, x, y, area?}. x e y vêm juntos (número 0–100 ou null = sem posição); area ausente = não mexe.
-- Valida o lote inteiro ANTES de gravar (nada pela metade); mesa de outra loja é ignorada (store_id é o limite de confiança).
CREATE OR REPLACE FUNCTION public.update_tables_positions_secure(p_store_id uuid, p_items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'p_items deve ser um array'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'lote grande demais (máximo 200 mesas)'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (e ? 'x') <> (e ? 'y')
       or (e ? 'x' and jsonb_typeof(e->'x') not in ('number', 'null'))
       or (e ? 'y' and jsonb_typeof(e->'y') not in ('number', 'null'))
       or (jsonb_typeof(e->'x') = 'number' and (e->>'x')::numeric not between 0 and 100)
       or (jsonb_typeof(e->'y') = 'number' and (e->>'y')::numeric not between 0 and 100)
       or (e ? 'area' and jsonb_typeof(e->'area') not in ('string', 'null'))
       or length(coalesce(e->>'area', '')) > 40
  ) then raise exception 'itens inválidos'; end if;

  update tables t set
    floor_x = case when i.e ? 'x' then nullif(i.e->>'x', '')::numeric else t.floor_x end,
    floor_y = case when i.e ? 'y' then nullif(i.e->>'y', '')::numeric else t.floor_y end,
    area    = case when i.e ? 'area' then nullif(btrim(i.e->>'area'), '') else t.area end
  from (select e from jsonb_array_elements(p_items) e) i
  where t.id = (i.e->>'id')::uuid and t.store_id = p_store_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
GRANT EXECUTE ON FUNCTION public.update_tables_positions_secure(uuid, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- Reversão (se precisar): DROP FUNCTION public.update_tables_positions_secure(uuid, jsonb); ALTER TABLE public.tables DROP COLUMN area;
