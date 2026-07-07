# Configuração do Emissor Fiscal — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** criar os campos (schema + tela editável) que faltam pra configurar
o emissor fiscal de cada loja — ambiente (homologação/produção), CSC/CSCID,
série e numeração sequencial por tipo de documento. **Escopo explícito
(pedido do usuário, reunião com o Ramon em 2026-07-06): só criar os campos
e deixá-los editáveis — NÃO é pra implementar emissão de NFC-e de verdade
ainda.** Ramon vai preencher os valores reais manualmente depois que a
contabilidade passar os dados (credenciamento na SEFAZ ainda pendente pra
maioria das lojas, ver "Backlog" em AGENTS.md).

**Origem dos campos:** cruzamento de dois vídeos assistidos em 2026-07-07 —
um tutorial de referência de um sistema concorrente (WinPro,
"Configurar Emissor Fiscal") e a gravação da reunião com o Ramon (que
confirmou os mesmos campos e acrescentou o detalhe de precisar de CSC
separado por ambiente).

**Arquitetura:** dois padrões já estabelecidos neste projeto, reaproveitados
sem inventar nada novo:
1. Campos não-sigilosos (ambiente, série, último número, inscrição
   municipal, etc.) — tabela nova `store_fiscal_config`, mesmo nível de
   "público pra quem tem a chave anônima" que `store_fiscal_certificates`
   já tem hoje (não é segredo, é configuração).
2. CSC/CSCID — são um segredo compartilhado com a SEFAZ (usado pra gerar o
   hash do QR Code da NFC-e), mesma sensibilidade da senha do certificado.
   Tabela nova `store_fiscal_config_secrets`, **write-only** (sem policy de
   SELECT nenhuma), escrita só via `app/api/certificado` (que já roda com
   a service role key — vai ganhar mais um bloco de escrita, não uma rota
   nova).

**Fora de escopo desta rodada** (registrar, não implementar): "Padrões de
impostos" (CST/CSOSN/PIS/COFINS/IPI) que o vídeo de referência também
mostra — isso exigiria classificação fiscal (NCM) por produto, que não
existe no cadastro de produto hoje; é uma frente bem maior (praticamente um
módulo fiscal completo), fora do pedido específico desta reunião. CT-e/MDF-e
foram citados como "bom ter" mas não prioridade — os campos entram no
schema mesmo assim (custo baixo de adicionar a coluna), mas não são
destacados na UI com o mesmo peso de NF-e/NFC-e.

---

## Task M1: Migration `024_config_emissor_fiscal.sql`

**Files:** Create `supabase/migrations/024_config_emissor_fiscal.sql`

```sql
-- Configuracao do emissor fiscal por loja (2026-07-07) — so' os campos,
-- sem logica de emissao real ainda (ver AGENTS.md, secao dedicada, e
-- docs/plans/2026-07-07-config-emissor-fiscal-plan.md pro contexto
-- completo). Dois padroes ja estabelecidos: campos nao-sigilosos publicos
-- (mesmo nivel de store_fiscal_certificates) e CSC/CSCID write-only (mesma
-- sensibilidade da senha do certificado).

create table if not exists store_fiscal_config (
  store_id uuid primary key references stores(id) on delete cascade,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  nfe_serie int,
  nfce_serie int,
  cte_serie int,
  mdfe_serie int,
  nfe_ultimo_numero int not null default 0,
  nfce_ultimo_numero int not null default 0,
  cte_ultimo_numero int not null default 0,
  mdfe_ultimo_numero int not null default 0,
  inscricao_municipal text,
  casas_decimais int not null default 2,
  cnpj_autorizado text,
  observacao_nfe text,
  observacao_pedido text,
  updated_at timestamptz not null default now()
);

alter table store_fiscal_config enable row level security;
drop policy if exists "allow_all_anon" on store_fiscal_config;
create policy "allow_all_anon" on store_fiscal_config
  for all to anon, authenticated using (true) with check (true);

-- CSC/CSCID separados por ambiente (a mesma loja precisa ter os dois pares
-- prontos, pra poder alternar homologacao<->producao sem reconfigurar).
-- Write-only de verdade, mesmo principio da senha do certificado
-- (006_fiscal_certificado.sql): sem NENHUMA policy de SELECT pra anon.
create table if not exists store_fiscal_config_secrets (
  store_id uuid primary key references stores(id) on delete cascade,
  csc_homologacao text,
  cscid_homologacao text,
  csc_producao text,
  cscid_producao text,
  updated_at timestamptz not null default now()
);

alter table store_fiscal_config_secrets enable row level security;

drop policy if exists "fiscal_secrets_insert_anon" on store_fiscal_config_secrets;
create policy "fiscal_secrets_insert_anon" on store_fiscal_config_secrets
  for insert to anon, authenticated with check (true);

drop policy if exists "fiscal_secrets_update_anon" on store_fiscal_config_secrets;
create policy "fiscal_secrets_update_anon" on store_fiscal_config_secrets
  for update to anon, authenticated using (true) with check (true);

-- Sem policy de select/delete — mesmo padrao de store_fiscal_certificate_secrets.
```

**Step 2:** Aplicar via `node scripts/aplicar-migration.mjs 024_config_emissor_fiscal.sql`.
**Step 3:** Testar via `node scripts/db.mjs`: inserir/atualizar uma linha de
teste em `store_fiscal_config` pra uma loja de teste (Bistrô Demo),
confirmar leitura via `select`; inserir uma linha de teste em
`store_fiscal_config_secrets`, confirmar que um `select` **direto** (sem
service role) não devolve nada — mesmo teste de write-only já feito pra
`store_fiscal_certificate_secrets` em 2026-07-05. Apagar os dados de teste
depois.
**Step 4:** Commit: `feat: schema da configuracao do emissor fiscal (ambiente, CSC/CSCID, serie e numeracao)`

---

## Task A1: `app/api/certificado/route.ts` — mais um bloco de escrita

**Files:** Modify `app/api/certificado/route.ts`, `lib/api.ts`

O `POST` já existente ganha mais campos opcionais no `FormData` (além dos
já existentes `file`/`originalFilename`/`expiresAt`/`password`):
`ambiente`, `nfeSerie`, `nfceSerie`, `cteSerie`, `mdfeSerie`,
`nfeUltimoNumero`, `nfceUltimoNumero`, `cteUltimoNumero`,
`mdfeUltimoNumero`, `inscricaoMunicipal`, `casasDecimais`,
`cnpjAutorizado`, `observacaoNfe`, `observacaoPedido`,
`cscHomologacao`, `cscidHomologacao`, `cscProducao`, `cscidProducao`.

Quando qualquer um dos campos não-sigilosos vier presente, faz um `upsert`
em `store_fiscal_config` (service role key, mesmo client já usado no
resto da rota). Quando `cscHomologacao`/`cscidHomologacao`/`cscProducao`/
`cscidProducao` vierem presentes (mesmo padrão do campo `password` já
existente: string vazia ou ausente = "não mexer nesse campo", só atualiza
o que veio preenchido), faz um `upsert` em `store_fiscal_config_secrets`.

Em `lib/api.ts`: nova função `updateStoreFiscalConfig(storeId, config)`
que monta o `FormData` e chama a rota (mesmo padrão de
`saveStoreCertificateMetadata`/`uploadStoreCertificate` já existentes —
procure essas funções no arquivo pra copiar exatamente o estilo). Nova
função `fetchStoreFiscalConfig(storeId)` que lê direto de
`store_fiscal_config` (não é sigiloso, não precisa passar pela API route) —
devolve `null`/objeto default quando a loja ainda não tem linha
configurada (loja nunca configurada = todos os campos "vazios", não é
erro).

**Step 2:** `npx tsc --noEmit -p tsconfig.json`. **Step 3:** Commit:
`feat: rota e funcoes de api pra configuracao do emissor fiscal`

---

## Task B1: `components/modules/AdminModule.tsx` — tela do Master Admin

**Files:** Modify `components/modules/AdminModule.tsx`

Na mesma seção "Certificado Digital (fiscal)" do modal "Editar Loja" (onde
já estão validade/senha/upload do certificado — procure por
`certExpiresAt`/`certPassword` no arquivo pra achar o bloco exato), logo
abaixo, adicionar uma nova sub-seção "Configuração do emissor" com:

1. **Ambiente**: dropdown "Homologação" / "Produção" (default
   Homologação — nunca começar em produção por acidente).
2. **Documentos fiscais** (agrupado visualmente, NF-e e NFC-e em destaque,
   CT-e/MDF-e num bloco secundário/colapsável "Avançado" já que não são
   prioridade agora): pra cada tipo, campo "Série" (número) e "Último
   número emitido" (número, default 0 — com texto de ajuda "Deixe 0 se
   nunca emitiu nenhuma nota deste tipo").
3. **CSC/CSCID**: dois pares de campos, um bloco "Homologação" e um bloco
   "Produção" (cada um com CSC + CSCID), tipo `password` nos campos de CSC
   (mesmo tratamento visual da senha do certificado — mostra
   "•••••••• (configurado)" se já tiver valor salvo, sem nunca mostrar o
   valor de verdade, já que a leitura é write-only).
4. **Outros campos**: Inscrição municipal (opcional), Casas decimais
   (número, default 2), CNPJ Autorizado (opcional), Observação padrão pra
   NF-e (texto), Observação padrão pra Pedido/Orçamento (texto).
5. Botão "Salvar Configuração Fiscal" (pode ser o mesmo botão "Salvar
   Certificado" já existente, ampliado pra mandar os campos novos também,
   ou um botão separado — decida pelo que ficar mais natural na tela sem
   forçar; se decidir juntar num só, mantenha os textos de sucesso/erro
   claros sobre o que foi salvo).
6. **Aviso fixo, sempre visível nessa seção** (reforça a regra crítica já
   documentada em AGENTS.md): "⚠️ Sempre configure e teste em Homologação
   primeiro. Nunca emita nota fiscal real durante testes."

Ao abrir o modal "Editar Loja" pra uma loja existente, carregar os valores
atuais via `fetchStoreFiscalConfig(storeId)` (campos não-sigilosos) — os
campos de CSC não vêm preenchidos de volta (write-only), só mostram
"configurado"/"não configurado" baseado em ter ou não linha em
`store_fiscal_config_secrets` (pode expor só um booleano
`has_csc_homologacao`/`has_csc_producao` a partir da API, sem nunca
devolver o valor).

**Step 2:** `npx tsc --noEmit -p tsconfig.json`. **Step 3:** Teste manual:
abrir "Editar Loja" da Bistrô Demo, preencher os campos novos (ambiente
Homologação, série/número de teste, um CSC de teste), salvar, reabrir o
modal e confirmar que os campos não-sigilosos vêm preenchidos de volta e
os de CSC mostram "configurado" sem expor o valor. Reverter os campos de
teste pro estado vazio original depois (não deixar dado de teste
permanente na Bistrô Demo). **Step 4:** Commit:
`feat: tela de configuracao do emissor fiscal no Editar Loja (Master Admin)`

---

## Task D1: Atualizar `AGENTS.md`

Nova seção "Configuração do emissor fiscal (`store_fiscal_config`,
migration 024)" — documentar os dois padrões (público vs. write-only),
listar os campos, deixar claro que é só armazenamento/configuração, sem
lógica de emissão real (mesma ressalva já usada pra seção "Certificado
digital fiscal"). Atualizar lista de migrations (024).

Commit: `docs: documenta configuracao do emissor fiscal (migration 024)`

---

## Resumo de arquivos tocados

- `supabase/migrations/024_config_emissor_fiscal.sql` (novo)
- `app/api/certificado/route.ts`, `lib/api.ts`
- `components/modules/AdminModule.tsx`
- `AGENTS.md`
