-- Lojas de Teste (NTB Vendas): qualquer loja marcada is_test=true nunca
-- escreve de verdade na Omie via NTB Estoque (o gate central já existe do
-- lado Estoque, migrations 117-119 daquele repo — aqui só marca a loja e
-- controla quem enxerga ela no seletor). Generaliza o "Plano A" anterior
-- (Sertão isolado) pras 2 lojas que já existem no Vendas.

alter table stores add column if not exists is_test boolean not null default false;
alter table universal_users add column if not exists pode_ver_lojas_teste boolean not null default false;

-- authenticate_universal_user_secure (015_universal_login.sql) recriada só
-- pra incluir pode_ver_lojas_teste no jsonb de retorno -- resto do corpo
-- idêntico (rate-limit de 5 tentativas/5min já existente, sem mudança).
create or replace function public.authenticate_universal_user_secure(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user universal_users%rowtype;
begin
  select * into v_user from universal_users where email = p_email for update;
  if not found then
    return jsonb_build_object('success', false);
  end if;

  if v_user.login_locked_until is not null and v_user.login_locked_until > now() then
    return jsonb_build_object('success', false, 'locked', true);
  end if;

  if v_user.password <> p_password then
    update universal_users set
      login_attempts = login_attempts + 1,
      login_locked_until = case when login_attempts + 1 >= 5 then now() + interval '5 minutes' else login_locked_until end
    where id = v_user.id;
    return jsonb_build_object('success', false);
  end if;

  update universal_users set login_attempts = 0, login_locked_until = null where id = v_user.id;
  return jsonb_build_object(
    'success', true,
    'mustChangePass', v_user.must_change_password,
    'user', jsonb_build_object('id', v_user.id, 'name', v_user.name, 'email', v_user.email, 'pode_ver_lojas_teste', v_user.pode_ver_lojas_teste)
  );
end;
$$;

grant execute on function public.authenticate_universal_user_secure(text, text) to anon, authenticated;

-- Duplicação completa: substitui o trio (categories insert + RPC
-- duplicate_products_secure sem mapeamento de ID + loop de adicionais
-- inexistente) usado hoje por duplicateStore() em lib/api.ts. Atômico,
-- mapeamento de ID via tabela temporária, copia categorias -> produtos ->
-- grupos de opção -> opções, tudo numa função só.
create or replace function public.duplicate_store_completo_secure(
  p_store_id_origem uuid,
  p_store_id_destino uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r_cat record;
  r_prod record;
  r_grupo record;
  v_novo_id uuid;
  v_novo_grupo_id uuid;
begin
  create temporary table map_categorias (old_id uuid primary key, new_id uuid) on commit drop;
  create temporary table map_produtos (old_id uuid primary key, new_id uuid) on commit drop;

  for r_cat in select * from categories where store_id = p_store_id_origem loop
    insert into categories (store_id, name, "order")
    values (p_store_id_destino, r_cat.name, r_cat."order")
    returning id into v_novo_id;
    insert into map_categorias values (r_cat.id, v_novo_id);
  end loop;

  for r_prod in select * from products where store_id = p_store_id_origem loop
    insert into products (store_id, category_id, name, description, price, image_url, available, prep_time_minutes)
    values (
      p_store_id_destino,
      (select new_id from map_categorias where old_id = r_prod.category_id),
      r_prod.name, r_prod.description, r_prod.price, r_prod.image_url, r_prod.available, r_prod.prep_time_minutes
    )
    returning id into v_novo_id;
    insert into map_produtos values (r_prod.id, v_novo_id);

    for r_grupo in select * from product_option_groups where product_id = r_prod.id loop
      insert into product_option_groups (product_id, name, type, required, min_select, max_select, "order")
      values (v_novo_id, r_grupo.name, r_grupo.type, r_grupo.required, r_grupo.min_select, r_grupo.max_select, r_grupo."order")
      returning id into v_novo_grupo_id;

      insert into product_options (group_id, name, price_delta, available, "order")
      select v_novo_grupo_id, name, price_delta, available, "order"
      from product_options where group_id = r_grupo.id;
    end loop;
  end loop;
end;
$$;

grant execute on function public.duplicate_store_completo_secure(uuid, uuid) to anon, authenticated;
