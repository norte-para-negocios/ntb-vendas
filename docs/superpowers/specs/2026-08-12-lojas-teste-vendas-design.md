# Lojas de Teste (NTB Vendas) — Design

**Data:** 2026-08-12

**Gatilho:** o projeto "Lojas de Teste" no NTB Estoque (concluído hoje,
migrations 117-119) criou um mecanismo geral e seguro — qualquer loja
marcada `is_test=true` nunca escreve de verdade na Omie, mesmo usando as
rotas reais de integração. O usuário quer que o NTB Vendas também tenha
lojas de teste correspondentes, com cardápio pronto, ligadas a esse
mecanismo, e capazes de emitir/consultar nota fiscal em homologação.

**Supersede o Plano A anterior**: `docs/superpowers/plans/
2026-08-12-sertao-teste-vendas.md` (nunca executado, migrations 042/043
nunca criadas) cobria só a loja Sertão isolada, apontando pro endpoint
estreito `/api/integracao/ordem-producao-teste` do NTB Estoque. Esse
plano fica obsoleto — este design substitui e generaliza pra 2 lojas,
usando a rota REAL de integração (`/api/integracao/ordem-producao`),
segura hoje graças ao gate central do lado Estoque.

## Auditoria (não re-investigar)

- **Escopo confirmado com o usuário**: só 2 lojas — "Vieras e Vinhos"
  (id `2ca5ce4f-4ab6-40a2-a234-a78cbff9f129`, CNPJ
  `50.493.129/0001-57`, corresponde à "Vinhas & Vinhetos" do Estoque) e
  "O Sertão Vai Virar Mar" (id `4f8a9e1a-6c3d-4b2e-9f7a-8e5c1d2b3a90`,
  CNPJ `39.912.717/0001-45`). As outras 4 lojas do Estoque (Donana×4)
  não existem no NTB Vendas — fora de escopo.
- **`duplicateStore()`** (`lib/api.ts:1060-1113`) já existe e funciona:
  duplica `stores` (nome, cnpj, slug+sufixo, contrato, config), todas as
  `categories`, todos os `products` (via RPC `duplicate_products_secure`,
  migration 021 — só copia `name/description/price/image_url/available/
  prep_time_minutes`, sem `promo_price`/`featured`/`tags`/`omie_codigo`/
  NCM), e a contagem de mesas (`sync_store_tables_secure`).
- **Não duplica hoje** (confirmado, zero referência dentro da função):
  `product_option_groups`/`product_options` (adicionais/opcionais),
  `store_fiscal_config`/`_secrets`, `store_ntb_estoque_secrets`,
  `store_users`.
- **Achado real**: "Vieras e Vinhos" tem 6 grupos de adicionais / 24
  opções (bordas, tamanhos etc.) — sem estender a duplicação, a loja de
  teste ficaria com cardápio incompleto. "O Sertão" tem 0 adicionais —
  pra ela, a duplicação atual já bastaria nesse quesito específico.
- **Config fiscal**: as duas lojas já têm `store_fiscal_config`
  preenchido (`ambiente=homologacao`, séries) — dado público, copiável
  direto. CSC/CSCID (`store_fiscal_config_secrets`) é write-only por
  design (migration 024) — não dá pra ler de volta, precisa ser
  reconfigurado manualmente. Como é o mesmo CNPJ da loja real, é o
  MESMO CSC já emitido pela SEFAZ (não precisa gerar nada novo, só
  re-digitar o valor já existente).
- **`store_ntb_estoque_secrets`** (migration 027, schema `store_id,
  ntb_estoque_url, ntb_estoque_api_key`, write-only): só "Vieras e
  Vinhos" tem hoje, e a `ntb_estoque_url` está desatualizada
  (`https://ntb-estoque.vercel.app` — o app real roda no Contabo desde
  a migração de infra documentada em `AGENTS.md` do NTB Estoque). Vai
  ser substituída por uma nova, apontando pra
  `https://app-estoque.norteparanegocios.com.br` + a chave de
  integração REAL da loja de teste correspondente no Estoque (ids 9 e
  12, criadas hoje na migration 117).
- **Sem onboarding público** — tudo passa pelo Master Admin manual.

## Escopo desta rodada

### 1. Estender a duplicação pra incluir adicionais/opcionais

Nova RPC `duplicate_store_completo_secure(p_store_id_origem uuid,
p_store_id_destino uuid)`, `security definer`, que substitui o trecho de
produtos de `duplicateStore()` (mantendo categorias/mesas como já
funcionam hoje, sem mudança). Faz TUDO numa única function SQL
(atômico), com mapeamento de ID via tabelas temporárias
(`on commit drop`):

```sql
create or replace function public.duplicate_store_completo_secure(
  p_store_id_origem uuid,
  p_store_id_destino uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r_cat record;
  r_prod record;
  r_grupo record;
  v_novo_id uuid;
  v_novo_grupo_id uuid;
begin
  create temporary table map_categorias (old_id uuid primary key, new_id uuid) on commit drop;
  create temporary table map_produtos (old_id uuid primary key, new_id uuid) on commit drop;

  for r_cat in select * from categories where store_id = p_store_id_origem loop
    insert into categories (store_id, name, "order")
    values (p_store_id_destino, r_cat.name, r_cat."order")
    returning id into v_novo_id;
    insert into map_categorias values (r_cat.id, v_novo_id);
  end loop;

  for r_prod in select * from products where store_id = p_store_id_origem loop
    insert into products (store_id, category_id, name, description, price, image_url, available, prep_time_minutes)
    values (
      p_store_id_destino,
      (select new_id from map_categorias where old_id = r_prod.category_id),
      r_prod.name, r_prod.description, r_prod.price, r_prod.image_url, r_prod.available, r_prod.prep_time_minutes
    )
    returning id into v_novo_id;
    insert into map_produtos values (r_prod.id, v_novo_id);

    for r_grupo in select * from product_option_groups where product_id = r_prod.id loop
      insert into product_option_groups (product_id, name, type, required, min_select, max_select, "order")
      values (v_novo_id, r_grupo.name, r_grupo.type, r_grupo.required, r_grupo.min_select, r_grupo.max_select, r_grupo."order")
      returning id into v_novo_grupo_id;

      insert into product_options (group_id, name, price_delta, available, "order")
      select v_novo_grupo_id, name, price_delta, available, "order"
      from product_options where group_id = r_grupo.id;
    end loop;
  end loop;
end;
$$;

grant execute on function public.duplicate_store_completo_secure(uuid, uuid) to anon, authenticated;
```

`lib/api.ts` `duplicateStore()` passa a chamar essa RPC única em vez do
trio atual (`categories` insert + `duplicate_products_secure` +
loop de adicionais não-existente) — simplificação real, não só adição.
`sync_store_tables_secure` continua como está (mesas não têm adicionais
nem dependência de produto).

### 2. Schema `is_test` (mesmo padrão do Plano A anterior, agora
aplicado a 2 lojas)

```sql
alter table stores add column if not exists is_test boolean not null default false;
alter table universal_users add column if not exists pode_ver_lojas_teste boolean not null default false;
```

`authenticate_universal_user_secure` (RPC, migration 015) passa a
incluir `pode_ver_lojas_teste` no `user` retornado. `fetchAllStores()`
(client-side, `StoreLogin`) filtra `is_test` pra quem não tem a flag —
mesmo design já aprovado no Plano A anterior, sem mudança.

### 3. Criar as 2 lojas de teste

Via Master Admin: `duplicateStore()` (agora estendido) em cada uma das
2 lojas reais, depois `UPDATE stores SET is_test=true, name='[TESTE] '
|| name WHERE id=<nova>`. `pode_ver_lojas_teste=true` pra você e pro
Ramon (confirmar os emails reais antes, não adivinhar).

### 4. Config fiscal das 2 lojas de teste

`store_fiscal_config` copiado (dado público, mesmo `ambiente=
homologacao`, séries — usar séries DIFERENTES das lojas reais pra nunca
colidir numeração, ex: incrementar em 900 ou usar uma faixa reservada).
CSC/CSCID reconfigurado manualmente (mesmo valor já emitido pra esse
CNPJ, só re-digitar) — passo manual, não dá pra automatizar (write-
only).

### 5. Integração com o NTB Estoque

`store_ntb_estoque_secrets` de cada loja de teste aponta pra
`https://app-estoque.norteparanegocios.com.br` + `ntb_estoque_api_key`
= a `integracao_api_key` REAL da loja de teste correspondente no Estoque
(ids 9 = gêmea de Vieras/Vinhas, 12 = gêmea do Sertão — confirmar/gerar
essas chaves via SSH no Estoque antes de configurar aqui, mesmo padrão
já usado na migration 061 do lado Estoque). Isso usa a rota REAL
`/api/integracao/ordem-producao` (não a estreita antiga) — segura
porque o gate central do lado Estoque bloqueia qualquer escrita real na
Omie pra lojas `is_test=true`.

## Fora de escopo (explícito)

- As 4 Donanas — não existem no NTB Vendas, ficam de fora até serem
  cadastradas de verdade (projeto separado, se/quando o usuário pedir).
- Onboarding público de loja nova — continua manual via Master Admin.
- O endpoint estreito antigo do Estoque
  (`/api/integracao/ordem-producao-teste`) — fica obsoleto, não é
  removido, sem relação com este projeto.
- `promo_price`/`featured`/`tags`/`omie_codigo`/NCM dos produtos — a
  duplicação de produtos continua sem copiar esses campos (limitação
  pré-existente de `duplicate_products_secure`, não introduzida por
  este projeto — se o usuário quiser corrigir, é um projeto à parte).

## Testes

- Duplicar "Vieras e Vinhos" com a RPC nova, confirmar: mesma contagem
  de categorias/produtos/grupos/opções que a loja original, preços e
  `price_delta` batendo exato, `min_select`/`max_select`/`required`
  preservados.
- Confirmar que a loja de teste NÃO aparece no seletor pra um universal
  user sem `pode_ver_lojas_teste=true`.
- Fechar uma comanda de teste na loja de teste, confirmar que dispara
  `/api/integracao/ordem-producao` real (não a estreita) contra a loja
  de teste do Estoque, e que NENHUMA chamada real chega na Omie (mesmo
  teste já feito hoje do lado Estoque — `integration_attempts` com
  `[SIMULADO]`).
- Emitir uma NFC-e de teste, confirmar `ambiente=homologacao` de
  verdade (protocolo real da SEFAZ em homologação, mesmo fluxo já
  validado em sessões anteriores).
