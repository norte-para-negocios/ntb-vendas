-- updateCategoryOrder/updateProductOrder faziam um UPDATE por item, num loop
-- await sequencial (N round-trips pro banco a cada drag-and-drop). A ideia
-- inicial era resolver com um upsert único, mas um upsert só com {id, order}
-- falha (testado direto na API): sem os outros campos NOT NULL da linha
-- (store_id, name em categories), o Postgrest rejeita com "null value in
-- column store_id violates not-null constraint" — o ON CONFLICT DO UPDATE
-- ainda constrói a tupla de INSERT e valida as constraints antes de resolver
-- o conflito. Por isso aqui é um UPDATE...FROM jsonb_array_elements em vez de
-- upsert: atualiza só a coluna order, sem tocar nas demais, num round-trip só.

create or replace function public.update_categories_order(p_updates jsonb)
returns void
language plpgsql
as $$
begin
  update categories c
  set "order" = (u->>'order')::int
  from jsonb_array_elements(p_updates) u
  where c.id = (u->>'id')::uuid;
end;
$$;

create or replace function public.update_products_order(p_updates jsonb)
returns void
language plpgsql
as $$
begin
  update products p
  set "order" = (u->>'order')::int
  from jsonb_array_elements(p_updates) u
  where p.id = (u->>'id')::uuid;
end;
$$;

grant execute on function public.update_categories_order(jsonb) to anon, authenticated;
grant execute on function public.update_products_order(jsonb) to anon, authenticated;
