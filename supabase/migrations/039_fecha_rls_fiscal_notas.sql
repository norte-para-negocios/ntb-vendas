-- Fecha o vazamento cross-tenant de fiscal_notas (achado crítico da
-- revisão final de branch, 2026-08-06). A policy "fiscal_notas_select_anon"
-- (034_fiscal_notas_e_emissao_automatica.sql) liberava SELECT sem NENHUM
-- filtro de loja pra qualquer um com a chave anônima pública — mesma classe
-- de vazamento já corrigida uma vez neste repo pra orders/order_items
-- (021/022_fecha_rls_orders_products.sql), reaberta aqui numa tabela nova.
-- Encadeado com app/api/fiscal/pdf-url/route.ts (que só checava "ALGUMA
-- linha de fiscal_notas referencia esse path", não qual loja), dava pra: ler
-- fiscal_notas de QUALQUER loja da plataforma (valor de venda, chave de
-- acesso, protocolo, pdf_path/xml_path) e trocar esse path por uma signed
-- URL de verdade — baixando o PDF real com CNPJ/endereço da loja e, em
-- NF-e, CPF/nome reais do cliente.
--
-- Correção segue o mesmo padrão já estabelecido neste repo pra dado
-- sensível de venda (fetch_sales_history_secure, security definer, scoped
-- por store_id): fecha o SELECT direto e expõe só via RPC.
drop policy if exists "fiscal_notas_select_anon" on fiscal_notas;

-- Sem NENHUMA policy de select/insert/update/delete pra anon/authenticated
-- daqui em diante — leitura só via RPC abaixo, escrita só via service role
-- (app/api/fiscal/emitir, que já usa supabaseAdmin e ignora RLS).
create or replace function public.fetch_fiscal_notas_secure(p_store_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select * from fiscal_notas where store_id = p_store_id order by created_at desc
  ) t;
$$;

grant execute on function public.fetch_fiscal_notas_secure(uuid) to anon, authenticated;
