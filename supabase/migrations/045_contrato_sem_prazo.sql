-- Contrato "em aberto"/infinito (2026-08-16, pedido explícito do usuário):
-- contract_period_months era NOT NULL, obrigando a loja a sempre ter um
-- número de meses. NULL passa a significar "sem prazo definido" -- não é
-- lido em nenhum lugar do código pra bloquear/expirar a loja automaticamente
-- (confirmado antes de mexer: só é exibido no formulário de edição), então
-- essa mudança é puramente de representação, sem efeito colateral em nada
-- que já funciona.

alter table stores alter column contract_period_months drop not null;
