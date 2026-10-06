-- 165 — "Esgotar" só gerente/dono (06/10/2026): a versão nova do app só mostra o controle no cadastro de produto e valida o
-- operador no servidor. A função antiga (151) fica para os apps antigos até todos atualizarem; depois dela sair, o servidor
-- passa a recusar também o caminho antigo (ver AGENTS.md).
create or replace function public.set_product_sold_out_v2(p_store_id uuid, p_product_id uuid, p_sold_out boolean, p_operator_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if p_operator_user_id is null or p_store_id is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from universal_users x where x.id = p_operator_user_id) then
    select role into r from store_users where id = p_operator_user_id and store_id = p_store_id;
    if r is null or r not in ('owner', 'manager') then raise exception 'só gerente ou dono marca produto como esgotado' using errcode = '42501'; end if;
  end if;
  update products set sold_out = coalesce(p_sold_out, false) where id = p_product_id and store_id = p_store_id;
  return found;
end $$;
grant execute on function public.set_product_sold_out_v2(uuid, uuid, boolean, uuid) to anon, authenticated;
notify pgrst, 'reload schema';
