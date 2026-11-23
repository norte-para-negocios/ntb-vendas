-- 195: maquininhas de cartão da loja (23/11/2026, spec .scratch/maquininha-omie).
-- O caixa marca a maquininha (GetNet, Rede...) em cada pagamento de cartão (payment_details.methods[].acquirer) e o Norte ERP
-- usa isso para lançar o título na conta certa do Omie. Aqui: a lista de maquininhas que a loja tem, chaves de MAQUININHA_LABELS
-- (lib/labels.ts). Vazio = loja sem escolha de maquininha (a tela de pagamento fica como sempre foi).
-- Aplicar: docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < 195_maquininhas_da_loja.sql (o NOTIFY vai no fim).

alter table public.stores add column if not exists maquininhas text[] not null default '{}';

-- Sertão usa as duas maquininhas.
update public.stores set maquininhas = '{getnet,rede}' where id = '4f8a9e1a-6c3d-4b2e-9f7a-8e5c1d2b3a90';

-- Escrita pela equipe da loja (mesmo padrão de update_store_cover_secure, migration 191). Só aceita chaves do catálogo fechado.
create or replace function public.update_store_maquininhas_secure(p_store_id uuid, p_maquininhas text[], p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lista text[];
begin
  if not _sessao_equipe_ok(p_token, p_store_id, false) then return jsonb_build_object('success', false, 'message', 'Sessão vencida. Saia e entre de novo.'); end if;
  v_lista := coalesce(p_maquininhas, '{}');
  if exists (select 1 from unnest(v_lista) m where m is null or m <> all (array['getnet','rede','cielo','stone','pagseguro','mercadopago','sumup'])) then
    return jsonb_build_object('success', false, 'message', 'Maquininha desconhecida.');
  end if;
  update stores set maquininhas = (select coalesce(array_agg(distinct m order by m), '{}') from unnest(v_lista) m) where id = p_store_id;
  if not found then return jsonb_build_object('success', false, 'message', 'Loja não encontrada.'); end if;
  return jsonb_build_object('success', true);
end $$;
grant execute on function public.update_store_maquininhas_secure(uuid, text[], text) to anon, authenticated;

notify pgrst, 'reload schema';
