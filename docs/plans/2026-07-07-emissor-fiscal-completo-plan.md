# Emissor Fiscal Completo + Acesso do Lojista — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** dois pedidos explícitos do usuário, em cima do que já foi feito
em `docs/plans/2026-07-07-config-emissor-fiscal-plan.md`:
1. Adicionar os 2 blocos do vídeo de referência (WinPro) que ficaram de
   fora da primeira rodada: **Identificação da empresa** (Razão Social,
   Nome Fantasia, Tipo, Inscrição Estadual, Endereço) e **Padrões de
   impostos** (CST/CSOSN, CST/PIS, CST/COFINS, CST/IPI, Frete padrão, Tipo
   de pagamento padrão, Natureza de operação padrão) — todos campos de
   *default* por loja (não é classificação por produto/NCM, é só mais
   configuração estática, mesmo nível dos campos já existentes).
2. Abrir a tela inteira (certificado digital + configuração do emissor,
   com os campos novos incluídos) também pro **lojista**, em
   `StoreModule.tsx` (`MenuManagementView`, mesma área de configurações
   gerais onde já estão taxa de serviço/sugestões/mais vendidos) — hoje só
   o Master Admin tem acesso (decisão consciente registrada na reunião com
   o Ramon: "só está para a gente do Master, por enquanto"; "por enquanto"
   terminou agora).

**Continua fora de escopo** (não mudou): classificação fiscal por produto
(NCM individual) — os campos de "Padrões de impostos" são só o *default*
da loja, usado como ponto de partida quando a emissão de verdade for
implementada; nenhuma lógica de emissão de NFC-e real está sendo feita
aqui, só armazenamento/configuração, mesmo escopo de sempre.

**Arquitetura:** tudo entra na mesma tabela `store_fiscal_config` já
existente (não é sigiloso, mesmo nível de RLS `allow_all_anon` de tudo
que já está lá) — só mais colunas. A tela do lojista reusa exatamente as
mesmas funções (`fetchStoreFiscalConfig`/`updateStoreFiscalConfig`/
`uploadStoreCertificate`/`saveStoreCertificateMetadata`/
`saveStoreCertificateSecret`/`fetchStoreCertificateStatus`) já criadas
pro Master Admin — não precisa de nenhuma RPC nova nem mudança de
segurança: este app já trata "ter o `store_id`" como o limite de
confiança em toda operação do lojista (mesmo princípio de
`updateStoreConfig`/`createProduct` etc.), então a tela nova só chama o
que já existe, com o `store.id` da sessão do lojista.

---

## Task M1: Migration `025_emissor_fiscal_identificacao_impostos.sql`

**Files:** Create `supabase/migrations/025_emissor_fiscal_identificacao_impostos.sql`

```sql
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
```

**Step 2:** Aplicar via `node scripts/aplicar-migration.mjs
025_emissor_fiscal_identificacao_impostos.sql`. **Step 3:** Testar via
`node scripts/db.mjs`: `select column_name from information_schema.columns
where table_name='store_fiscal_config'` confirmando as 18 colunas novas.
**Step 4:** Commit: `feat: campos de identificacao da empresa e padroes de impostos no emissor fiscal`

---

## Task A1: `app/api/certificado/route.ts` + `lib/api.ts` — mais campos

**Files:** Modify `app/api/certificado/route.ts`, `lib/api.ts`, `types/index.ts`

Mesmo padrão já usado pros campos da primeira rodada (`readOptionalString`/
`readOptionalInt` já existem na rota, reusar): a rota ganha mais ~18
campos opcionais lidos do `FormData` (`razaoSocial`, `nomeFantasia`,
`tipoPessoa`, `inscricaoEstadual`, `enderecoLogradouro`/`Numero`/
`Complemento`/`Bairro`/`Cidade`/`Uf`/`Cep`, `cstCsosnPadrao`/`CstPisPadrao`/
`CstCofinsPadrao`/`CstIpiPadrao`, `fretePadrao`, `tipoPagamentoPadrao`,
`naturezaOperacaoPadrao`) — todos entram no mesmo bloco de upsert parcial
em `store_fiscal_config` que já existe (só adicionar aos `configFields`
condicionalmente, mesmo `if (x !== undefined) configFields.y = x` já
usado).

`UpdateStoreFiscalConfigParams` e `StoreFiscalConfig` (em `lib/api.ts`/
`types/index.ts`) ganham os campos novos correspondentes (camelCase no
params de entrada, snake_case no tipo de leitura, mesmo padrão já
estabelecido).

**Step 2:** `npx tsc --noEmit -p tsconfig.json`. **Step 3:** Commit:
`feat: api aceita campos de identificacao da empresa e padroes de impostos`

---

## Task B1: `components/modules/AdminModule.tsx` — completar a tela existente

**Files:** Modify `components/modules/AdminModule.tsx`

Na seção "Configuração do Emissor" já existente (criada na rodada
anterior), adicionar duas sub-seções novas, na mesma ordem que o vídeo de
referência mostra (identificação primeiro, depois padrões de impostos,
antes do bloco "Documentos fiscais" que já existe — ou logo depois, o que
ficar mais natural no fluxo da tela):

1. **Identificação da empresa**: Razão Social, Nome Fantasia, Tipo
   (select Jurídica/Física), Inscrição Estadual, e um bloco de Endereço
   (Logradouro, Número, Complemento, Bairro, Cidade, UF — select ou input
   de 2 letras, CEP). Mesmo estilo visual do resto da tela.
2. **Padrões de impostos**: CST/CSOSN Padrão, CST/PIS Padrão, CST/COFINS
   Padrão, CST/IPI Padrão, Frete Padrão, Tipo de Pagamento Padrão,
   Natureza de Operação Padrão — todos `Input` de texto simples (são
   códigos alfanuméricos tipo "102", "49", "0 - Emitente"; não precisa
   virar select com opções fixas, texto livre já resolve pro escopo
   atual — adicionar um texto de ajuda pequeno tipo "código conforme
   tabela da SEFAZ/contabilidade" em cada campo ou no topo do bloco).

Estado novo (`useState`) pra cada campo, seguindo exatamente o mesmo
padrão dos campos fiscais já existentes (`fiscalNfeSerie` etc.) —
populados em `handleEditStore` a partir do `fiscalConfig` já buscado,
resetados em `resetFiscalConfigForm`, incluídos no payload de
`handleSaveFiscalConfig` (mesmo princípio: só entra no payload o que
estiver preenchido).

**Step 2:** `npx tsc --noEmit -p tsconfig.json`. **Step 3:** Commit:
`feat: identificacao da empresa e padroes de impostos na tela do Master Admin`

---

## Task B2: `components/modules/StoreModule.tsx` — abrir a tela pro lojista

**Files:** Modify `components/modules/StoreModule.tsx`

Na área de configurações gerais de `MenuManagementView` (mesma seção de
taxa de serviço, sugestões de observação, mais vendidos — procure por
`serviceFeeEnabled`/`handleToggleServiceFee` pra achar o bloco certo),
adicionar uma seção nova "Certificado e Configuração Fiscal" com **a
mesma tela completa que já existe no Master Admin**: certificado digital
(upload de arquivo, senha, validade, status, botão remover — reusar
`uploadStoreCertificate`/`saveStoreCertificateMetadata`/
`saveStoreCertificateSecret`/`fetchStoreCertificateStatus`, mesmo
comportamento de `AdminModule.tsx`) + configuração do emissor completa
(ambiente, documentos fiscais, CSC/CSCID, identificação da empresa,
padrões de impostos — tudo que a Task B1 acabou de adicionar no Master
Admin, reusando `fetchStoreFiscalConfig`/`updateStoreFiscalConfig`).

Pode ser extraído como um componente compartilhado
(`FiscalConfigSection` ou nome parecido, num arquivo novo tipo
`components/FiscalConfigSection.tsx`) usado tanto por `AdminModule.tsx`
quanto por `StoreModule.tsx`, pra não duplicar ~300 linhas de JSX/estado
— **decisão de quem implementar**: se a duplicação começar a ficar grande
e mecânica demais, extrair; se o contexto de cada tela for
suficientemente diferente (Master Admin tem outros campos ao redor tipo
dados de contrato, lojista tem outros campos ao redor tipo taxa de
serviço), pode ser mais simples manter duplicado mesmo, sem
abstração prematura — usar julgamento, mas relatar a decisão tomada.

O aviso fixo de homologação (⚠️ sempre testar em homologação) continua
igual, visível nas duas telas.

**Step 2:** `npx tsc --noEmit -p tsconfig.json`. **Step 3:** Teste manual
(Bistrô Demo, sessão do lojista): abrir a nova seção, preencher um campo
de teste, salvar, recarregar, confirmar que persiste; reverter o campo de
teste depois. **Step 4:** Commit: `feat: certificado e configuracao do emissor fiscal acessivel pelo lojista`

---

## Task D1: Atualizar `AGENTS.md`

Atualizar a seção "Configuração do emissor fiscal" já existente: listar
os campos novos (Identificação da empresa, Padrões de impostos), e
documentar que agora tanto Master Admin quanto lojista têm acesso à tela
completa (registrar a mudança de decisão: "só Master, por enquanto" →
aberto pro lojista também, por pedido explícito do usuário em
2026-07-07). Atualizar lista de migrations (025).

Commit: `docs: atualiza documentacao do emissor fiscal (campos completos + acesso do lojista)`

---

## Resumo de arquivos tocados

- `supabase/migrations/025_emissor_fiscal_identificacao_impostos.sql` (novo)
- `app/api/certificado/route.ts`, `lib/api.ts`, `types/index.ts`
- `components/modules/AdminModule.tsx`
- `components/modules/StoreModule.tsx`
- (opcional) `components/FiscalConfigSection.tsx` (novo, se decidir extrair)
- `AGENTS.md`
