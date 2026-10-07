-- 171 — Produto que chega do Norte Estoque já com categoria (grupo) e preço > 0 entra DISPONÍVEL no cardápio.
-- Sem categoria ou sem preço continua indisponível (como antes). Produto que já existe no Vendas nunca é reativado
-- aqui: só a inativação vinda do Estoque propaga (o lojista manda na disponibilidade). Mesmo corpo da função em
-- produção (aplicada pela 170 e correções), só os dois INSERTs mudaram. Aplicar:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d ntb_vendas < 171_catalogo_disponivel_com_categoria_preco.sql
CREATE OR REPLACE FUNCTION public.aplicar_catalogo_estoque(p_store uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modo text; g jsonb; p jsonb; v_ts timestamptz; v_id uuid; v_gid uuid; v_eid bigint; v_pai bigint; v_nome text;
  r_g jsonb := '[]'::jsonb; r_p jsonb := '[]'::jsonb; v_cat uuid; v_ex products%rowtype; v_mae products%rowtype; v_grp uuid; v_opt product_options%rowtype;
  v_valor text; v_preco numeric; v_cod text; v_ativo boolean; v_atual timestamptz; v_gmap jsonb := '{}'::jsonb; v_prof int; v_chave text;
begin
  select stock_mode into v_modo from stores where id = p_store;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_store using errcode = '22023'; end if;
  perform set_config('ntb.sync_skip', '1', true);

  -- mapa id do Estoque -> pai do Estoque (para achar a categoria de grupos mais fundos)
  for g in select * from jsonb_array_elements(coalesce(p_payload -> 'grupos', '[]'::jsonb)) loop
    v_gmap := v_gmap || jsonb_build_object(g ->> 'estoque_id', coalesce(g ->> 'pai_estoque_id', ''));
  end loop;

  for g in select * from jsonb_array_elements(coalesce(p_payload -> 'grupos', '[]'::jsonb)) loop
    v_eid := (g ->> 'estoque_id')::bigint; v_nome := btrim(g ->> 'nome'); v_ts := coalesce((g ->> 'updated_at')::timestamptz, now());
    if v_nome is null or v_nome = '' then continue; end if;
    v_pai := nullif(g ->> 'pai_estoque_id', '')::bigint;
    v_id := null;
    if v_pai is null then
      -- raiz: grupo de categorias (ou, se o Vendas já a tinha como categoria sem grupo, a mesma categoria)
      select id into v_id from category_groups where store_id = p_store and estoque_grupo_id = v_eid;
      if v_id is null and nullif(g ->> 'vendas_ref', '') is not null then
        select id into v_id from category_groups where store_id = p_store and id = (g ->> 'vendas_ref')::uuid;
        if v_id is not null then update category_groups set estoque_grupo_id = v_eid where id = v_id; end if;
        if v_id is null then
          select id into v_id from categories where store_id = p_store and id = (g ->> 'vendas_ref')::uuid;
          if v_id is not null then update categories set estoque_grupo_id = v_eid where id = v_id and estoque_grupo_id is null; end if;
        end if;
      end if;
      if v_id is null then
        select id into v_id from category_groups where store_id = p_store and estoque_grupo_id is null and lower(name) = lower(v_nome) limit 1;
        if v_id is not null then update category_groups set estoque_grupo_id = v_eid where id = v_id; end if;
      end if;
      if v_id is null then
        insert into category_groups (store_id, name, "order", estoque_grupo_id, updated_at)
        values (p_store, v_nome, coalesce((g ->> 'ordem')::int, 0), v_eid, v_ts) returning id into v_id;
      else
        select updated_at into v_atual from category_groups where id = v_id;
        if v_atual is not null and v_ts > v_atual then update category_groups set name = v_nome, "order" = coalesce((g ->> 'ordem')::int, "order"), updated_at = v_ts where id = v_id; end if;
      end if;
    else
      -- só o 2º nível vira categoria; níveis mais fundos ficam no Estoque
      select id into v_gid from category_groups where store_id = p_store and estoque_grupo_id = v_pai;
      if v_gid is null then continue; end if;
      select id into v_id from categories where store_id = p_store and estoque_grupo_id = v_eid;
      if v_id is null and nullif(g ->> 'vendas_ref', '') is not null then
        select id into v_id from categories where store_id = p_store and id = (g ->> 'vendas_ref')::uuid;
        if v_id is not null then update categories set estoque_grupo_id = v_eid where id = v_id and estoque_grupo_id is null; end if;
      end if;
      if v_id is null then
        select id into v_id from categories where store_id = p_store and estoque_grupo_id is null and group_id = v_gid and lower(name) = lower(v_nome) limit 1;
        if v_id is not null then update categories set estoque_grupo_id = v_eid where id = v_id; end if;
      end if;
      if v_id is null then
        insert into categories (store_id, name, "order", group_id, estoque_grupo_id, updated_at)
        values (p_store, v_nome, coalesce((g ->> 'ordem')::int, 0), v_gid, v_eid, v_ts) returning id into v_id;
      else
        select updated_at into v_atual from categories where id = v_id;
        if v_atual is not null and v_ts > v_atual then update categories set name = v_nome, "order" = coalesce((g ->> 'ordem')::int, "order"), group_id = v_gid, updated_at = v_ts where id = v_id; end if;
      end if;
    end if;
    r_g := r_g || jsonb_build_object('estoque_id', v_eid, 'vendas_ref', v_id);
  end loop;

  for p in select * from jsonb_array_elements(coalesce(p_payload -> 'produtos', '[]'::jsonb)) loop
    v_ts := coalesce((p ->> 'updated_at')::timestamptz, now());
    v_nome := btrim(p ->> 'nome'); v_cod := nullif(p ->> 'codigo', ''); v_preco := coalesce((p ->> 'preco')::numeric, 0);
    v_ativo := coalesce((p ->> 'ativo')::boolean, true);

    -- categoria do produto: sobe pela árvore do Estoque até achar categoria (2º nível) ou grupo raiz (categoria implícita)
    v_cat := null; v_eid := nullif(p ->> 'grupo_estoque_id', '')::bigint; v_prof := 0;
    while v_eid is not null and v_cat is null and v_prof < 6 loop
      v_prof := v_prof + 1;
      select id into v_cat from categories where store_id = p_store and estoque_grupo_id = v_eid;
      if v_cat is null then
        select id, name into v_gid, v_chave from category_groups where store_id = p_store and estoque_grupo_id = v_eid;
        if v_gid is not null then
          select id into v_cat from categories where store_id = p_store and group_id = v_gid and lower(name) = lower(v_chave) limit 1;
          if v_cat is null then
            insert into categories (store_id, name, "order", group_id, estoque_grupo_id) values (p_store, v_chave, 0, v_gid, v_eid) returning id into v_cat;
          end if;
        end if;
      end if;
      if v_cat is null then v_eid := nullif(v_gmap ->> v_eid::text, '')::bigint; end if;
    end loop;

    if nullif(p ->> 'pai_codigo', '') is not null or (coalesce((p ->> 'mae')::boolean, false) = false and nullif(p ->> 'pai_codigo', '') is not null) then
      -- variação: opção do grupo de variação da mãe
      select * into v_mae from products where store_id = p_store and estoque_pai_codigo = p ->> 'pai_codigo';
      if v_mae.id is null then continue; end if;
      v_grp := grupo_variacao_do_produto(v_mae.id);
      if v_grp is null then
        select id into v_grp from product_option_groups where product_id = v_mae.id and name = 'Variação' limit 1;
        if v_grp is null then
          insert into product_option_groups (product_id, name, type, required, "order", price_rule) values (v_mae.id, 'Variação', 'single', true, 0, 'sum') returning id into v_grp;
        end if;
      end if;
      select * into v_opt from product_options where group_id = v_grp and omie_codigo = v_cod;
      v_valor := coalesce((select value from jsonb_each_text(coalesce(p -> 'atributos', '{}'::jsonb)) limit 1), v_nome);
      if v_opt.id is null then
        if v_preco < v_mae.price then
          update product_options set price_delta = price_delta + (v_mae.price - v_preco) where group_id = v_grp;
          update products set price = v_preco where id = v_mae.id;
          v_mae.price := v_preco;
        end if;
        insert into product_options (group_id, name, price_delta, "order", available, omie_codigo, estoque_preco)
        values (v_grp, v_valor, greatest(0, v_preco - v_mae.price), coalesce((select max("order") + 1 from product_options where group_id = v_grp), 0), v_ativo, v_cod, v_preco)
        returning * into v_opt;
      else
        if not v_ativo and v_opt.available then update product_options set available = false where id = v_opt.id; end if;
      end if;
      update products set estoque_sync_at = now() where id = v_mae.id;
      r_p := r_p || jsonb_build_object('codigo', v_cod, 'vendas_ref', v_opt.id);

    elsif coalesce((p ->> 'mae')::boolean, false) then
      select * into v_ex from products where store_id = p_store and (estoque_pai_codigo = v_cod or id = nullif(p ->> 'vendas_ref', '')::uuid) limit 1;
      if v_ex.id is null then
        if v_nome is null or v_nome = '' then continue; end if;
        insert into products (store_id, category_id, name, price, available, estoque_pai_codigo, ncm, estoque_sync_at, updated_at)
        values (p_store, v_cat, v_nome, v_preco, (v_ativo and v_cat is not null and v_preco > 0), v_cod, nullif(p ->> 'ncm', ''), now(), v_ts) returning * into v_ex;
      else
        if v_ex.estoque_pai_codigo is null and v_cod is not null and coalesce(v_ex.omie_codigo, '') = '' then update products set estoque_pai_codigo = v_cod where id = v_ex.id; end if;
        if v_ts > v_ex.updated_at then
          update products set name = coalesce(nullif(v_nome, ''), name), category_id = coalesce(v_cat, category_id), updated_at = v_ts where id = v_ex.id;
        end if;
        if not v_ativo and v_ex.available then update products set available = false where id = v_ex.id; end if;
        update products set estoque_sync_at = now() where id = v_ex.id;
      end if;
      r_p := r_p || jsonb_build_object('codigo', v_cod, 'vendas_ref', v_ex.id);

    else
      select * into v_ex from products where store_id = p_store and ((v_cod is not null and omie_codigo = v_cod) or id = nullif(p ->> 'vendas_ref', '')::uuid) limit 1;
      if v_ex.id is null then
        if v_nome is null or v_nome = '' or v_cod is null then continue; end if;
        insert into products (store_id, category_id, name, price, available, omie_codigo, ncm, estoque_sync_at, updated_at)
        values (p_store, v_cat, v_nome, v_preco, (v_ativo and v_cat is not null and v_preco > 0), v_cod, nullif(p ->> 'ncm', ''), now(), v_ts) returning * into v_ex;
      else
        if coalesce(v_ex.omie_codigo, '') = '' and v_cod is not null then update products set omie_codigo = v_cod where id = v_ex.id; end if;
        if v_ts > v_ex.updated_at then
          update products set name = coalesce(nullif(v_nome, ''), name), category_id = coalesce(v_cat, category_id), updated_at = v_ts where id = v_ex.id;
        end if;
        if not v_ativo and v_ex.available then update products set available = false where id = v_ex.id; end if;
        if v_ex.ncm is null and nullif(p ->> 'ncm', '') is not null then update products set ncm = p ->> 'ncm' where id = v_ex.id; end if;
        update products set estoque_sync_at = now() where id = v_ex.id;
      end if;
      r_p := r_p || jsonb_build_object('codigo', v_cod, 'vendas_ref', v_ex.id);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'grupos', r_g, 'produtos', r_p);
end $function$;

notify pgrst, 'reload schema';
