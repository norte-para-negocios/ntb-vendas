-- Emissor fiscal completo (2026-07-07, 2a rodada): campos de
-- Identificacao da empresa e Padroes de impostos que faltavam do video de
-- referencia (WinPro). Mesma tabela publica ja existente
-- (store_fiscal_config), so mais colunas -- nenhuma delas e sigilosa.
-- "Padroes de impostos" aqui sao DEFAULT por loja, nao classificacao por
-- produto/NCM (isso continua fora de escopo).

alter table store_fiscal_config add column if not exists razao_social text;
alter table store_fiscal_config add column if not exists nome_fantasia text;
alter table store_fiscal_config add column if not exists tipo_pessoa text not null default 'juridica' check (tipo_pessoa in ('juridica', 'fisica'));
alter table store_fiscal_config add column if not exists inscricao_estadual text;
alter table store_fiscal_config add column if not exists endereco_logradouro text;
alter table store_fiscal_config add column if not exists endereco_numero text;
alter table store_fiscal_config add column if not exists endereco_complemento text;
alter table store_fiscal_config add column if not exists endereco_bairro text;
alter table store_fiscal_config add column if not exists endereco_cidade text;
alter table store_fiscal_config add column if not exists endereco_uf text;
alter table store_fiscal_config add column if not exists endereco_cep text;

alter table store_fiscal_config add column if not exists cst_csosn_padrao text;
alter table store_fiscal_config add column if not exists cst_pis_padrao text;
alter table store_fiscal_config add column if not exists cst_cofins_padrao text;
alter table store_fiscal_config add column if not exists cst_ipi_padrao text;
alter table store_fiscal_config add column if not exists frete_padrao text;
alter table store_fiscal_config add column if not exists tipo_pagamento_padrao text;
alter table store_fiscal_config add column if not exists natureza_operacao_padrao text;

