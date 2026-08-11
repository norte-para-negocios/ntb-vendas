-- Telefone do emissor pro cupom fiscal ("Fone: N/D" hoje — o campo nunca
-- existiu em nenhuma tabela, nem stores nem store_fiscal_config). Mesmo
-- nível de sensibilidade dos outros campos de store_fiscal_config
-- (público, allow_all_anon) — não é segredo.
alter table store_fiscal_config add column if not exists telefone text;
