-- 159: validação NO SERVIDOR de quem pode trocar mesa, mover item, cancelar item e cancelar pedido (04/10, regra do dono:
-- só gerente e quem tem a permissão 'trocas' fazem isso; garçom nunca). Até aqui só a tela escondia o botão: as funções
-- cancel_order_item_secure / transfer_items_secure / move_table_secure aceitavam qualquer chamada com a chave anônima.
-- Estratégia aditiva: funções *_v2 que exigem um operador da loja e conferem o papel/permissões dele; as antigas continuam
-- iguais (apps antigos seguem funcionando até o deploy; depois do deploy revogar o execute delas, ver o fim deste arquivo).
-- LIMITE HONESTO: o app não tem sessão no servidor. O operador chega como p_operator_user_id (uuid) e o servidor confere
-- o PAPEL dele, mas não consegue provar que quem chamou é mesmo essa pessoa (precisaria de token de sessão/Supabase Auth).
-- Barra: tela escondida + chamada sem operador + garçom com o próprio id + permissions {}. Não barra: quem forja o uuid de um gerente.

create or replace function public.operator_can_secure(p_store_id uuid, p_user_id uuid, p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  u store_users%rowtype;
  v jsonb;
begin
  if p_user_id is null or p_store_id is null then return false; end if;
  if exists (select 1 from universal_users x where x.id = p_user_id) then return true; end if;
  select * into u from store_users where id = p_user_id and store_id = p_store_id;
  if not found then return false; end if;
  if u.role = 'owner' then return true; end if;
  if u.role = 'open' then return false; end if;
  -- permissões individuais que já existiam (mesmo mapa de lib/rolePermissions.ts)
  if coalesce(u.permissions->>'trocas', 'false') = 'true' and p_action in ('cancelar_item', 'trocar_mesa', 'mover_item', 'cancelar_pedido') then return true; end if;
  if coalesce(u.permissions->>'supervisiona_caixa', 'false') = 'true' and p_action in ('cancelar_pedido', 'ver_excecoes') then return true; end if;
  -- matriz da loja (Equipe > Permissões); sem valor salvo: só gerente pode
  select s.config->'role_permissions'->u.role->p_action into v from stores s where s.id = p_store_id;
  if v is not null and jsonb_typeof(v) = 'boolean' then return (v #>> '{}')::boolean; end if;
  return u.role = 'manager';
end;
$$;
grant execute on function public.operator_can_secure(uuid, uuid, text) to anon, authenticated;

create or replace function public.cancel_order_item_v2(
  p_item_id uuid, p_operator_user_id uuid, p_operator_name text default null, p_reason text default null, p_action text default 'cancelar_item')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store uuid;
begin
  select store_id into v_store from order_items where id = p_item_id;
  if v_store is null then return jsonb_build_object('success', false, 'message', 'Item não encontrado.'); end if;
  if p_action not in ('cancelar_item', 'cancelar_pedido') then p_action := 'cancelar_item'; end if;
  if not operator_can_secure(v_store, p_operator_user_id, p_action) then
    return jsonb_build_object('success', false, 'message', 'Sem permissão: só o gerente (ou quem tem a permissão de trocas) cancela item ou pedido.');
  end if;
  perform cancel_order_item_secure(p_item_id, p_operator_user_id, p_operator_name, p_reason);
  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.cancel_order_item_v2(uuid, uuid, text, text, text) to anon, authenticated;

create or replace function public.move_table_v2(p_source_table_id uuid, p_target_table_id uuid, p_operator_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_store_t uuid;
begin
  select store_id into v_store from tables where id = p_source_table_id;
  select store_id into v_store_t from tables where id = p_target_table_id;
  if v_store is null or v_store is distinct from v_store_t then
    return jsonb_build_object('success', false, 'message', 'Mesa inválida.');
  end if;
  if not operator_can_secure(v_store, p_operator_user_id, 'trocar_mesa') then
    return jsonb_build_object('success', false, 'message', 'Sem permissão: só o gerente (ou quem tem a permissão de trocas) troca de mesa.');
  end if;
  return move_table_secure(p_source_table_id, p_target_table_id);
end;
$$;
grant execute on function public.move_table_v2(uuid, uuid, uuid) to anon, authenticated;

create or replace function public.transfer_items_v2(
  p_store_id uuid, p_item_ids uuid[], p_target_table_id uuid, p_operator_user_id uuid, p_operator_name text default null, p_from_table_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not operator_can_secure(p_store_id, p_operator_user_id, 'mover_item') then
    return jsonb_build_object('success', false, 'message', 'Sem permissão: só o gerente (ou quem tem a permissão de trocas) move item de mesa.');
  end if;
  return transfer_items_secure(p_store_id, p_item_ids, p_target_table_id, p_operator_user_id, p_operator_name, p_from_table_id);
end;
$$;
grant execute on function public.transfer_items_v2(uuid, uuid[], uuid, uuid, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

-- DEPOIS do deploy do app (todos os computadores/celulares atualizados), fechar o caminho antigo, em outra migration:
--   revoke execute on function public.cancel_order_item_secure(uuid, uuid, text, text) from anon, authenticated;
--   revoke execute on function public.move_table_secure(uuid, uuid) from anon, authenticated;
--   revoke execute on function public.transfer_items_secure(uuid, uuid[], uuid, uuid, text, uuid) from anon, authenticated;
--   revoke execute on function public.cancel_pending_table_items_secure(uuid) from anon, authenticated;
-- (as v2 são security definer e chamam as antigas como dono, então continuam funcionando.)
