-- Integracao ntb-vendas -> ntb-estoque (2026-07-07): guarda por loja a URL base
-- e a chave de API do ntb-estoque (lojas.integracao_api_key la, migration 061
-- do ntb-estoque). NULL = loja sem integracao (todas, exceto a piloto "Vieras
-- e Vinhos" por enquanto).
--
-- Write-only de verdade (mesmo principio de store_fiscal_config_secrets,
-- migration 024): a `stores` normal tem "allow_all_anon" (select publico,
-- necessario pro cardapio carregar por slug), entao NAO da pra por essa chave
-- la -- vazaria pra qualquer um com a anon key, igual a vulnerabilidade
-- corrigida em 021/022. So a rota nova app/api/integracao/ordem-producao/
-- route.ts (service role, server-side) le essa tabela; o browser nunca ve a
-- chave -- ele so chama a rota interna passando orderId/tableId.
create table if not exists store_ntb_estoque_secrets (
  store_id uuid primary key references stores(id) on delete cascade,
  ntb_estoque_url text not null,
  ntb_estoque_api_key text not null,
  updated_at timestamptz not null default now()
);

alter table store_ntb_estoque_secrets enable row level security;

-- Sem policy nenhuma pra anon/authenticated: nem select, nem insert, nem
-- update. Diferente do store_fiscal_config_secrets (que o proprio lojista
-- preenche via UI), esta aqui e' configuracao tecnica de integracao entre
-- dois sistemas -- so' service role escreve (script/SQL direto), nunca o
-- browser.
