-- sync_product_option_groups (017_adicionais_padrao.sql) recriada só pra
-- também gravar omie_codigo por opção -- faltava desde a migration 026
-- (que criou a coluna product_options.omie_codigo mas nunca atualizou esta
-- function, então até hoje omie_codigo de opção só era populado via script
-- SQL ad-hoc, nunca pelo fluxo normal de "Salvar Produto"). Achado ao
-- desenhar a ferramenta de "consolidar produtos em variação" (2026-08-16):
-- sem isso, criar um grupo de variação a partir de produtos já cadastrados
-- perderia o omie_codigo de cada um, quebrando a Ordem de Produção
-- automática pra cada variação. Resto do corpo idêntico (apaga e recria
-- tudo numa transação só, mesmo padrão).

create or replace function public.sync_product_option_groups(
  p_product_id uuid,
  p_groups jsonb -- [{name, type, required, min_select, max_select, options:[{name, price_delta, available, omie_codigo}]}]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group jsonb;
  v_option jsonb;
  v_group_id uuid;
  v_group_order int := 0;
  v_option_order int;
begin
  delete from product_option_groups where product_id = p_product_id; -- cascade cuida de product_options

  for v_group in select * from jsonb_array_elements(p_groups)
  loop
    if coalesce(trim(v_group->>'name'), '') = '' then continue; end if;

    insert into product_option_groups (product_id, name, type, required, min_select, max_select, "order")
    values (
      p_product_id, trim(v_group->>'name'), coalesce(v_group->>'type', 'single'),
      coalesce((v_group->>'required')::boolean, false),
      nullif(v_group->>'min_select', '')::int, nullif(v_group->>'max_select', '')::int,
      v_group_order
    )
    returning id into v_group_id;
    v_group_order := v_group_order + 1;

    v_option_order := 0;
    for v_option in select * from jsonb_array_elements(coalesce(v_group->'options', '[]'::jsonb))
    loop
      if coalesce(trim(v_option->>'name'), '') = '' then continue; end if;
      insert into product_options (group_id, name, price_delta, available, "order", omie_codigo)
      values (
        v_group_id, trim(v_option->>'name'), coalesce((v_option->>'price_delta')::numeric, 0),
        coalesce((v_option->>'available')::boolean, true), v_option_order,
        nullif(trim(v_option->>'omie_codigo'), '')
      );
      v_option_order := v_option_order + 1;
    end loop;
  end loop;
end;
$$;

grant execute on function public.sync_product_option_groups(uuid, jsonb) to anon, authenticated;
