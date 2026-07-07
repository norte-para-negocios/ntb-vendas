-- Integracao ntb-vendas <-> ntb-estoque (2026-07-07): primeiro passo real,
-- so o campo de link + populacao inicial via match de nome contra a API do
-- Omie (loja piloto: Vieras e Vinhos). Nao implementa a chamada de API que
-- de fato cria Ordem de Producao no ntb-estoque -- isso e trabalho futuro
-- separado (precisa de uma rota nova la, que nao existe hoje). Ver AGENTS.md.

alter table products add column if not exists omie_codigo text;
alter table product_options add column if not exists omie_codigo text;

-- Populado nesta mesma sessao via scripts/db.mjs, direto contra a API
-- ListarProdutos do Omie (chaves da Vieras e Vinhos), casando por nome
-- normalizado: 224/243 produtos e 12/18 (Catupiry+Mussarela, 6 pizzas cada)
-- opcionais bateram exato. "Sem borda" nao precisa de codigo (R$0, nao
-- consome nada). 19 produtos + "Cheddar" ficaram sem match -- diferenca de
-- acentuacao/espaco/HTML entity no nome, precisam de revisao manual
-- (conferir com o Ramon/contabilidade se o nome no Omie ou no ntb-vendas
-- que esta desatualizado).
