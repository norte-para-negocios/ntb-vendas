-- Fecha o RLS aberto de store_fiscal_config (achado crítico da revisão
-- final de branch, 2026-08-06). A policy "allow_all_anon" (herdada de
-- 024_config_emissor_fiscal.sql, quando esta tabela era só armazenamento/
-- configuração passiva) liberava INSERT/UPDATE/DELETE pra qualquer um com
-- a chave anônima pública (hardcoded como fallback em lib/supabaseClient.ts,
-- ver AGENTS.md) — inofensivo quando a tabela só guardava config exibida na
-- tela. Deixou de ser inofensivo quando este branch acrescentou
-- `modelo_emissao_automatica` (migration 034): essa coluna agora é o
-- INTERRUPTOR real de transmissão pra SEFAZ (Task 14, disparo automático no
-- fechamento). Sem esta correção, qualquer um com a anon key podia, numa
-- única chamada REST: ligar emissão automática ('nfce'/'nfe') de qualquer
-- loja, virar o `ambiente` de 'homologacao' pra 'producao' (documento fiscal
-- REAL passa a ser emitido), ou adulterar os contadores de numeração
-- (nfe_ultimo_numero/nfce_ultimo_numero).
--
-- Mesmo padrão já usado nas correções críticas anteriores deste tipo
-- (021/022_fecha_rls_orders_products.sql): mantém leitura pública (a UI do
-- admin/lojista lê store_fiscal_config direto da tabela, sem passar por API
-- route — ver fetchStoreFiscalConfig em lib/api.ts e AGENTS.md, seção
-- "Configuração do emissor fiscal") e fecha toda escrita direta. Toda
-- escrita já passa por app/api/certificado (service role, ignora RLS por
-- completo) desde que a tabela foi criada — updateStoreFiscalConfig em
-- lib/api.ts só faz POST pra essa rota, nunca .upsert()/.update() direto
-- (confirmado lendo o código atual, não só o histórico). Ou seja: fechar a
-- escrita anônima aqui não muda nenhum comportamento legítimo da aplicação,
-- só remove um caminho que nunca deveria ter existido pro client.
drop policy if exists "allow_all_anon" on store_fiscal_config;

create policy "fiscal_config_select_anon" on store_fiscal_config
  for select to anon, authenticated using (true);

-- Sem NENHUMA policy de insert/update/delete pra anon/authenticated —
-- só service_role (que ignora RLS) grava, via app/api/certificado.
