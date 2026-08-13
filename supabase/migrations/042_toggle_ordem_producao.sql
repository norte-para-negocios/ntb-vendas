-- Hoje "Ordem de Produção automática" (integração com o ntb-estoque, ver
-- 027_ntb_estoque_integracao.sql) só liga/desliga apagando/reinserindo a
-- linha inteira de store_ntb_estoque_secrets, via SQL manual -- não existe
-- nenhuma UI pra isso. Adiciona um toggle explícito (`ativo`), pro lojista/
-- admin poder desligar temporariamente sem perder URL/chave já configuradas,
-- e uma function `security definer` pra UI conseguir mostrar "configurado?
-- ativo?" sem nunca ler a chave de volta (mesmo princípio write-only já
-- usado nesta tabela).

alter table store_ntb_estoque_secrets add column if not exists ativo boolean not null default true;

create or replace function public.fetch_ntb_estoque_integracao_status_secure(p_store_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
begin
  select ativo, ntb_estoque_url into v_row from store_ntb_estoque_secrets where store_id = p_store_id;
  if not found then
    return jsonb_build_object('configurado', false, 'ativo', false);
  end if;
  return jsonb_build_object('configurado', true, 'ativo', v_row.ativo, 'url', v_row.ntb_estoque_url);
end;
$$;

grant execute on function public.fetch_ntb_estoque_integracao_status_secure(uuid) to anon, authenticated;
