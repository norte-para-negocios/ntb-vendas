-- 151: "Esgotado" em tempo real (2026-10-04, plano próximas features, item 2).
-- Dois estados no produto: esgotado (aparece no cardápio marcado, não dá pra pedir) e oculto (available=false, já existe).
-- O servidor barra o pedido de produto esgotado mesmo se o aparelho ainda não atualizou a lista.
alter table products add column if not exists sold_out boolean not null default false;

create or replace function public.set_product_sold_out_secure(p_store_id uuid, p_product_id uuid, p_sold_out boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update products set sold_out = coalesce(p_sold_out, false) where id = p_product_id and store_id = p_store_id;
  return found;
end;
$$;
grant execute on function public.set_product_sold_out_secure(uuid, uuid, boolean) to anon, authenticated;

create or replace function public.bloquear_item_esgotado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_sold boolean;
begin
  if NEW.product_id is null then return NEW; end if;
  select name, sold_out into v_name, v_sold from products where id = NEW.product_id;
  if coalesce(v_sold, false) then
    raise exception 'Produto esgotado: %', v_name using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_bloquear_item_esgotado on public.order_items;
create trigger trg_bloquear_item_esgotado
  before insert on public.order_items
  for each row execute function public.bloquear_item_esgotado();

notify pgrst, 'reload schema';
