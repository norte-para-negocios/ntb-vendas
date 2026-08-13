# Lojas de Teste (NTB Vendas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Duplicar "Vieras e Vinhos" e "O Sertão Vai Virar Mar" em lojas de
teste completas (cardápio, adicionais, config fiscal em homologação,
integração com o NTB Estoque via as lojas de teste já existentes lá),
visíveis só pra quem tem `pode_ver_lojas_teste=true`.

**Architecture:** Uma RPC nova (`duplicate_store_completo_secure`) estende
a duplicação de loja existente pra também copiar adicionais/opcionais.
Duas colunas novas (`stores.is_test`, `universal_users.pode_ver_lojas_teste`)
controlam visibilidade. Execução real (duplicar as 2 lojas, configurar
fiscal/integração) acontece só no banco `ntb_vendas` do Contabo — nunca no
Supabase cloud de produção, que só recebe a migration de schema.

**Tech Stack:** PostgreSQL (self-hosted no Contabo + Supabase cloud),
Next.js/TypeScript, PostgREST.

## Global Constraints

- Produção real (Supabase cloud) só recebe a migration de **schema** (043)
  — nunca as duplicações de loja de teste em si, que só acontecem no banco
  `ntb_vendas` do Contabo (185.193.66.240, mesmo servidor do NTB Estoque).
  A migração de infra do NTB Vendas pro Contabo (Fases 1/2) aconteceu hoje
  em paralelo — `ntb_vendas` no Contabo é um banco isolado, self-hosted,
  com schema+dado sincronizados com o cloud até este momento.
- `npx tsc --noEmit` limpo antes de qualquer commit de código.
- Migrations aplicadas manualmente nos DOIS bancos:
  - Supabase cloud: `node scripts/aplicar-migration.mjs 043_lojas_teste.sql`
  - Contabo: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240` depois
    `docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -v ON_ERROR_STOP=1 < arquivo.sql`,
    seguido de `docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -c "NOTIFY pgrst, 'reload schema';"`
    (invalida o cache de schema do PostgREST — sem isso a API não vê
    tabela/coluna nova).
- **Nunca imprimir nenhuma chave/segredo em texto puro** (mesma regra do
  resto da sessão de hoje) — usar `grep -c`/contagem pra confirmar
  existência, nunca `cat`/`grep` direto num arquivo ou coluna com segredo.
- Nenhuma automação/cron deve disparar contra loja de teste — só ação
  manual do usuário/Ramon testando.
- Confirmar saúde do NTB Estoque (`docker ps` no Contabo + `curl -s -o
  /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login`
  esperando 200) antes e depois de qualquer mudança no Contabo — compartilha
  servidor com produção real do Estoque.
- A URL real do NTB Estoque em produção é
  `https://app-estoque.norteparanegocios.com.br` — nunca usar a URL antiga
  `https://ntb-estoque.vercel.app` (achado real: ainda aparece salva na
  config de produção da própria "Vieras e Vinhos", dado desatualizado, não
  repetir esse erro nas lojas de teste).

---

## Task 1: Migration 043 — schema (is_test, pode_ver_lojas_teste, RPC de duplicação completa)

**Files:**
- Create: `supabase/migrations/043_lojas_teste.sql`

**Interfaces:**
- Produces: coluna `stores.is_test boolean`, coluna
  `universal_users.pode_ver_lojas_teste boolean`, RPC
  `duplicate_store_completo_secure(p_store_id_origem uuid, p_store_id_destino
  uuid) returns void`, `authenticate_universal_user_secure` atualizada
  (mesma assinatura `(p_email text, p_password text) returns jsonb`, só o
  jsonb de retorno ganha o campo `pode_ver_lojas_teste`).

- [ ] **Step 1: Escrever a migration**

```sql
-- Lojas de Teste (NTB Vendas): qualquer loja marcada is_test=true nunca
-- escreve de verdade na Omie via NTB Estoque (o gate central já existe do
-- lado Estoque, migrations 117-119 daquele repo — aqui só marca a loja e
-- controla quem enxerga ela no seletor). Generaliza o "Plano A" anterior
-- (Sertão isolado) pras 2 lojas que já existem no Vendas.

alter table stores add column if not exists is_test boolean not null default false;
alter table universal_users add column if not exists pode_ver_lojas_teste boolean not null default false;

-- authenticate_universal_user_secure (015_universal_login.sql) recriada só
-- pra incluir pode_ver_lojas_teste no jsonb de retorno -- resto do corpo
-- idêntico (rate-limit de 5 tentativas/5min já existente, sem mudança).
create or replace function public.authenticate_universal_user_secure(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user universal_users%rowtype;
begin
  select * into v_user from universal_users where email = p_email for update;
  if not found then
    return jsonb_build_object('success', false);
  end if;

  if v_user.login_locked_until is not null and v_user.login_locked_until > now() then
    return jsonb_build_object('success', false, 'locked', true);
  end if;

  if v_user.password <> p_password then
    update universal_users set
      login_attempts = login_attempts + 1,
      login_locked_until = case when login_attempts + 1 >= 5 then now() + interval '5 minutes' else login_locked_until end
    where id = v_user.id;
    return jsonb_build_object('success', false);
  end if;

  update universal_users set login_attempts = 0, login_locked_until = null where id = v_user.id;
  return jsonb_build_object(
    'success', true,
    'mustChangePass', v_user.must_change_password,
    'user', jsonb_build_object('id', v_user.id, 'name', v_user.name, 'email', v_user.email, 'pode_ver_lojas_teste', v_user.pode_ver_lojas_teste)
  );
end;
$$;

grant execute on function public.authenticate_universal_user_secure(text, text) to anon, authenticated;

-- Duplicação completa: substitui o trio (categories insert + RPC
-- duplicate_products_secure sem mapeamento de ID + loop de adicionais
-- inexistente) usado hoje por duplicateStore() em lib/api.ts. Atômico,
-- mapeamento de ID via tabela temporária, copia categorias -> produtos ->
-- grupos de opção -> opções, tudo numa função só.
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

- [ ] **Step 2: Aplicar no Supabase cloud de produção (só schema, sem dado de teste)**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
node scripts/aplicar-migration.mjs 043_lojas_teste.sql
```
Esperado: `MIGRATION APLICADA.`

- [ ] **Step 3: Confirmar saúde do Estoque ANTES de mexer no Contabo**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker ps --format '{{.Names}}\t{{.Status}}'"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```
Anote a lista de containers — compara de novo no fim da Task 7.

- [ ] **Step 4: Aplicar no Contabo (`ntb_vendas`)**

```bash
scp -i ~/.ssh/notebook_contabo_key "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas/supabase/migrations/043_lojas_teste.sql" root@185.193.66.240:/tmp/043.sql
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -v ON_ERROR_STOP=1 < /tmp/043.sql && rm /tmp/043.sql"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -c \"NOTIFY pgrst, 'reload schema';\""
```

- [ ] **Step 5: Confirmar as colunas/função existem nos dois bancos**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
node scripts/db.mjs "select count(*) from information_schema.columns where table_name='stores' and column_name='is_test'"
```
Esperado: `1`. Repita a mesma checagem no Contabo:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"select count(*) from information_schema.columns where table_name='stores' and column_name='is_test'\""
```

- [ ] **Step 6: Confirmar saúde do Estoque DEPOIS**

Repita o Step 3 — lista de containers e `HTTP 200` idênticos.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/043_lojas_teste.sql
git commit -m "feat: schema das Lojas de Teste (is_test, pode_ver_lojas_teste, duplicate_store_completo_secure)"
```

---

## Task 2: Tipos TypeScript + `lib/api.ts`

**Files:**
- Modify: `types/index.ts` (interfaces `Store`, `UniversalUser`)
- Modify: `lib/api.ts:1060-1113` (`duplicateStore()`)

**Interfaces:**
- Consumes: `duplicate_store_completo_secure(uuid, uuid)` (Task 1).
- Produces: `Store.is_test?: boolean`, `UniversalUser.pode_ver_lojas_teste?: boolean`,
  `duplicateStore(storeId: string): Promise<{ success: boolean; message?: string }>`
  (assinatura inalterada, corpo reescrito).

- [ ] **Step 1: Adicionar `is_test` em `Store`**

Em `types/index.ts`, dentro de `export interface Store { ... }` (linha 27),
logo depois de `is_active: boolean;`:

```typescript
  is_active: boolean;
  is_test?: boolean;
```

- [ ] **Step 2: Adicionar `pode_ver_lojas_teste` em `UniversalUser`**

```typescript
export interface UniversalUser {
  id: string;
  name: string;
  email: string;
  pode_ver_lojas_teste?: boolean;
}
```

- [ ] **Step 3: Rodar `npx tsc --noEmit` e confirmar limpo**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit
```
Esperado: sem erro novo (pode já existir ruído pré-existente — confirme que
nenhum erro novo aponta pros arquivos que você acabou de mudar).

- [ ] **Step 4: Reescrever `duplicateStore()` pra usar a RPC nova**

Em `lib/api.ts:1060-1113`, substituir o corpo inteiro (mantendo a mesma
assinatura `duplicateStore = async (storeId: string): Promise<{ success:
boolean; message?: string }>`):

```typescript
export const duplicateStore = async (storeId: string): Promise<{ success: boolean; message?: string }> => {
  try {
    const { data: originalStore, error: fetchError } = await supabase.from('stores').select('*').eq('id', storeId).single();
    if (fetchError || !originalStore) throw new Error('Loja original não encontrada.');
    let newSlug = `${originalStore.slug}-1`;
    const { data: existingSlug } = await supabase.from('stores').select('id').eq('slug', newSlug).maybeSingle();
    if (existingSlug) newSlug = `${newSlug}-${Math.random().toString(36).substring(2, 7)}`;
    const { data: newStore, error: createError } = await supabase
      .from('stores')
      .insert({ name: `${originalStore.name} (1)`, cnpj: originalStore.cnpj, slug: newSlug, contract_type: originalStore.contract_type, contract_period_months: originalStore.contract_period_months, is_active: originalStore.is_active, logo_url: originalStore.logo_url, config: originalStore.config })
      .select()
      .single();
    if (createError) throw createError;

    const { error: dupErr } = await supabase.rpc('duplicate_store_completo_secure', { p_store_id_origem: storeId, p_store_id_destino: newStore.id });
    if (dupErr) throw dupErr;

    const { data: originalTables } = await supabase.rpc('get_tables_secure', { p_store_id: storeId });
    const tableCount = (originalTables as any[])?.length || 0;
    if (tableCount > 0) {
      const { error: tablesError } = await supabase.rpc('sync_store_tables_secure', { p_store_id: newStore.id, p_target_count: tableCount });
      if (tablesError) console.error('Error duplicating tables:', tablesError);
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message || 'Erro desconhecido ao duplicar loja.' };
  }
};
```
Isso é uma simplificação real (RPC única em vez do trio categories+
duplicate_products_secure+loop-de-adicionais-inexistente), não só adição —
`duplicate_products_secure` (migration 021) fica sem uso depois desta
mudança, não precisa ser removida (sem risco, só órfã).

- [ ] **Step 5: `npx tsc --noEmit` de novo**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit
```
Esperado: limpo.

- [ ] **Step 6: Commit**

```bash
git add types/index.ts lib/api.ts
git commit -m "feat: is_test/pode_ver_lojas_teste nos tipos, duplicateStore usa RPC completa"
```

---

## Task 3: Filtro de visibilidade + trava de ambiente fiscal

**Files:**
- Modify: `components/modules/StoreModule.tsx:120-121` (filtro de `StoreLogin`)
- Modify: `components/modules/StoreModule.tsx` (select de `Ambiente` na config fiscal, hoje em torno da linha 3463-3470 — confirme a linha exata lendo o arquivo antes de editar, pode ter mudado)

**Interfaces:**
- Consumes: `Store.is_test`, `UniversalUser.pode_ver_lojas_teste` (Task 2).

- [ ] **Step 1: Filtrar lojas de teste no seletor da conta universal**

Em `components/modules/StoreModule.tsx`, a função que hoje é:

```typescript
        fetchAllStores().then((data) => {
            setStores(data.filter(s => s.is_active));
```

Passa a ser (o componente `StoreLogin` já tem `universalUser` no escopo
nesse ponto — confirme lendo o código ao redor da linha 120 antes de
editar; se o nome da variável de estado do usuário universal autenticado
for diferente, ajuste):

```typescript
        fetchAllStores().then((data) => {
            setStores(data.filter(s => s.is_active && (!s.is_test || universalUser?.pode_ver_lojas_teste)));
```

- [ ] **Step 2: Não mexer no segundo ponto de uso de `store`/`universalUser` (linha ~5213)**

Esse ponto (`if (universalUser && store && store.is_active) { ... }`, dentro
da restauração de sessão salva em `localStorage`) resolve UMA loja
específica já escolhida antes, não lista todas — não precisa do filtro de
`is_test`, confirmado lendo o código: se a sessão salva já era de uma loja
de teste, ela continua funcionando normalmente ao restaurar (comportamento
correto, sem mudança necessária aqui).

- [ ] **Step 3: Travar o ambiente fiscal em homologação pra loja de teste**

Encontre o `<select>` de `Ambiente` na seção de configuração fiscal
(`grep -n "value={fiscalAmbiente}" components/modules/StoreModule.tsx` pra
achar a linha exata, pode ter mudado). Adicione `disabled` quando a loja
for de teste:

```typescript
                        <select
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30 disabled:opacity-60 disabled:cursor-not-allowed"
                          value={fiscalAmbiente}
                          onChange={e => setFiscalAmbiente(e.target.value as 'homologacao' | 'producao')}
                          disabled={store.is_test}
                        >
                            <option value="homologacao">Homologação</option>
                            <option value="producao">Produção</option>
                        </select>
```
Se `store.is_test` não estiver diretamente no escopo desse ponto do JSX
(pode ser um componente separado que recebe `store` como prop — confirme
lendo o arquivo), ajuste pra pegar do jeito certo (ex.: prop já existente
do componente que envolve essa seção). Adicione também uma nota abaixo do
select, mesmo padrão visual do aviso de certificado já existente:
```typescript
                        {store.is_test && (
                            <p className="text-xs text-[var(--text-muted)]">🔒 Loja de teste — ambiente sempre em homologação.</p>
                        )}
```

- [ ] **Step 4: `npx tsc --noEmit` e commit**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit
git add components/modules/StoreModule.tsx
git commit -m "feat: filtra lojas de teste no seletor universal, trava ambiente fiscal em homologação"
```

- [ ] **Step 5: Push (dispara deploy automático na Vercel)**

```bash
git push origin main
```
Confirme antes de rodar: isso sobe o código de produção real via deploy
automático da Vercel (mesmo comportamento de sempre deste repo) — o
comportamento é aditivo/seguro (filtro só esconde loja que ainda não
existe em produção, `is_test` default `false` em toda loja real), mas é
uma ação de deploy real, execute com atenção.

---

## Task 4: Duplicar as 2 lojas de teste (só no Contabo)

**Files:**
- Nenhum arquivo neste repo — execução de SQL via SSH.

**Interfaces:**
- Consumes: `duplicate_store_completo_secure` (Task 1), já aplicada em
  `ntb_vendas` do Contabo.

- [ ] **Step 1: Confirmar saúde do Estoque ANTES**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker ps --format '{{.Names}}\t{{.Status}}'"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```

- [ ] **Step 2: Criar as 2 lojas de teste + duplicar cardápio completo**

IDs reais confirmados hoje: "Vieras e Vinhos" =
`2ca5ce4f-4ab6-40a2-a234-a78cbff9f129` (CNPJ `50.493.129/0001-57`), "O
Sertão Vai Virar Mar" = `4f8a9e1a-6c3d-4b2e-9f7a-8e5c1d2b3a90` (CNPJ
`39.912.717/0001-45`).

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas" << 'EOF'
do $$
declare
  v_teste_vieras uuid;
  v_teste_sertao uuid;
begin
  insert into stores (name, slug, cnpj, is_active, is_test, contract_type, contract_period_months, config)
  select '[TESTE] ' || name, slug || '-teste', cnpj, true, true, contract_type, contract_period_months, config
  from stores where id = '2ca5ce4f-4ab6-40a2-a234-a78cbff9f129'
  returning id into v_teste_vieras;
  perform duplicate_store_completo_secure('2ca5ce4f-4ab6-40a2-a234-a78cbff9f129', v_teste_vieras);

  insert into stores (name, slug, cnpj, is_active, is_test, contract_type, contract_period_months, config)
  select '[TESTE] ' || name, slug || '-teste', cnpj, true, true, contract_type, contract_period_months, config
  from stores where id = '4f8a9e1a-6c3d-4b2e-9f7a-8e5c1d2b3a90'
  returning id into v_teste_sertao;
  perform duplicate_store_completo_secure('4f8a9e1a-6c3d-4b2e-9f7a-8e5c1d2b3a90', v_teste_sertao);

  raise notice 'Vieras teste: % | Sertão teste: %', v_teste_vieras, v_teste_sertao;
end $$;
EOF
```
Anote os 2 UUIDs retornados no `NOTICE` — usados nas Tasks 5, 6 e 7.

- [ ] **Step 3: Confirmar as contagens batem com a loja original**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"select s.name, count(distinct c.id) categorias, count(distinct p.id) produtos, count(distinct g.id) grupos, count(distinct o.id) opcoes from stores s left join categories c on c.store_id=s.id left join products p on p.store_id=s.id left join product_option_groups g on g.product_id=p.id left join product_options o on o.group_id=g.id where s.name ilike '%Vieras%' or s.name ilike '%Sert%' group by s.name order by s.name\""
```
Esperado: cada loja `[TESTE] X` com as MESMAS contagens da loja original
correspondente (categorias/produtos/grupos/opções idênticos).

- [ ] **Step 4: Recarregar o schema cache do PostgREST e confirmar via API pública**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -c \"NOTIFY pgrst, 'reload schema';\""
curl -s "https://testvendase.norteparanegocios.com.br/rest/v1/stores?select=id,name,is_test&is_test=eq.true" -H "apikey: test"
```
Esperado: as 2 lojas de teste listadas, `is_test: true`.

- [ ] **Step 5: Confirmar saúde do Estoque DEPOIS**

Repita o Step 1.

---

## Task 5: Liberar acesso pro usuário universal

**Files:**
- Nenhum arquivo neste repo.

- [ ] **Step 1: Confirmar o email real do usuário universal a liberar**

**Não adivinhar.** Confirme com o usuário (Joaquim/Ramon) quais emails de
`universal_users` devem receber `pode_ver_lojas_teste=true` antes de
prosseguir — provavelmente `equipe@norteparanegocios.com.br` (o único
usuário universal confirmado existir hoje, `AGENTS.md` seção "Conta
universal"), mas confirme antes de aplicar.

- [ ] **Step 2: Aplicar (só no Contabo)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -c \"update universal_users set pode_ver_lojas_teste=true where email='<email confirmado no Step 1>';\""
```

- [ ] **Step 3: Confirmar**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"select email, pode_ver_lojas_teste from universal_users\""
```

---

## Task 6: Config fiscal das 2 lojas de teste (homologação, séries próprias)

**Files:**
- Nenhum arquivo neste repo.

**Interfaces:**
- Consumes: UUIDs das 2 lojas de teste (Task 4, Step 2).

- [ ] **Step 1: Copiar `store_fiscal_config` (dado público) com séries deslocadas**

Séries `+900` das originais evita colisão de numeração com a loja real
(mesmo princípio já documentado no AGENTS.md sobre faixas de série
reservadas — mas aqui é só pra nunca colidir com a numeração real, não
precisa ficar na faixa 900-969 especificamente, já que são lojas/CNPJ
diferentes na prática de emissão... na verdade CNPJ é o MESMO da loja
real, mesmo ambiente SEFAZ — por isso a série realmente precisa ser
diferente e nunca reaproveitada pela loja real. Use uma série alta fixa,
ex. `901`, pras duas):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas" << 'EOF'
insert into store_fiscal_config (store_id, ambiente, nfe_serie, nfce_serie, inscricao_municipal, casas_decimais, observacao_nfe, observacao_pedido, razao_social, nome_fantasia, tipo_pessoa, inscricao_estadual, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_cep, cst_csosn_padrao, cst_pis_padrao, cst_cofins_padrao, cst_ipi_padrao, frete_padrao, tipo_pagamento_padrao, natureza_operacao_padrao)
select '<uuid teste vieras>', 'homologacao', 901, 901, inscricao_municipal, casas_decimais, observacao_nfe, observacao_pedido, razao_social, '[TESTE] ' || nome_fantasia, tipo_pessoa, inscricao_estadual, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_cep, cst_csosn_padrao, cst_pis_padrao, cst_cofins_padrao, cst_ipi_padrao, frete_padrao, tipo_pagamento_padrao, natureza_operacao_padrao
from store_fiscal_config where store_id = '2ca5ce4f-4ab6-40a2-a234-a78cbff9f129'
on conflict (store_id) do nothing;

insert into store_fiscal_config (store_id, ambiente, nfe_serie, nfce_serie, inscricao_municipal, casas_decimais, observacao_nfe, observacao_pedido, razao_social, nome_fantasia, tipo_pessoa, inscricao_estadual, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_cep, cst_csosn_padrao, cst_pis_padrao, cst_cofins_padrao, cst_ipi_padrao, frete_padrao, tipo_pagamento_padrao, natureza_operacao_padrao)
select '<uuid teste sertao>', 'homologacao', 901, 901, inscricao_municipal, casas_decimais, observacao_nfe, observacao_pedido, razao_social, '[TESTE] ' || nome_fantasia, tipo_pessoa, inscricao_estadual, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_cep, cst_csosn_padrao, cst_pis_padrao, cst_cofins_padrao, cst_ipi_padrao, frete_padrao, tipo_pagamento_padrao, natureza_operacao_padrao
from store_fiscal_config where store_id = '4f8a9e1a-6c3d-4b2e-9f7a-8e5c1d2b3a90'
on conflict (store_id) do nothing;
EOF
```
Se a loja original não tiver linha em `store_fiscal_config` ainda (ex.:
"O Sertão" pode não ter configurado), o `insert...select` não insere nada
— confirme antes com `select store_id from store_fiscal_config where
store_id in (...)` e, se faltar, preencha os campos manualmente (não é
erro, é a loja original nunca ter configurado fiscal ainda).

- [ ] **Step 2: CSC/CSCID — passo manual, não automatizável**

CSC/CSCID (`store_fiscal_config_secrets`) é write-only por design
(migration 024) — não dá pra ler de volta da loja original pra copiar.
Como é o MESMO CNPJ da loja real, é o MESMO CSC já emitido pela SEFAZ:
reconfigurar manualmente pela UI (tela de configuração fiscal do
lojista/admin, campos CSC/CSCID de homologação), usando o Master Admin
logado como o usuário universal liberado na Task 5, apontando pra
`https://testvendase.norteparanegocios.com.br`. Confirme com o usuário
que valor de CSC usar antes — não adivinhar nem inventar.

---

## Task 7: Integração com o NTB Estoque (lojas de teste↔teste)

**Files:**
- Nenhum arquivo neste repo.

**Interfaces:**
- Consumes: UUIDs das 2 lojas de teste (Task 4, Step 2).

- [ ] **Step 1: Confirmar as chaves de integração das lojas de teste do Estoque existem (sem imprimir o valor)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select id, nome, integracao_api_key is not null as tem_chave from lojas where id in (9,12)\""
```
Esperado: 2 linhas, `tem_chave = t` nas duas (id 9 = gêmea de Vinhas &
Vinhetos, id 12 = gêmea de AMJ Santos/Sertão). Se alguma vier `f`, pare e
gere a chave lá no NTB Estoque antes de continuar (fora do escopo deste
plano — mesmo padrão de migration 061 daquele repo).

- [ ] **Step 2: Configurar `store_ntb_estoque_secrets` das 2 lojas de teste do Vendas**

Usa a mesma rota já pronta hoje (`app/api/integracao/configurar`) direto
via SQL (mais simples de automatizar que simular login na UI) — mas as
CHAVES em si (a `integracao_api_key` real das lojas 9/12 do Estoque)
precisam ser lidas de dentro de um script que nunca as imprime, e escritas
direto:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'bash -s' << 'REMOTE_SCRIPT'
set -e
docker exec -i supabase-db psql -U supabase_admin -d postgres -t -A -c "select integracao_api_key from lojas where id=9" > /tmp/chave9.txt
docker exec -i supabase-db psql -U supabase_admin -d postgres -t -A -c "select integracao_api_key from lojas where id=12" > /tmp/chave12.txt

docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas << SQL
insert into store_ntb_estoque_secrets (store_id, ntb_estoque_url, ntb_estoque_api_key, ativo)
values ('<uuid teste vieras>', 'https://app-estoque.norteparanegocios.com.br', '$(cat /tmp/chave9.txt)', true)
on conflict (store_id) do update set ntb_estoque_url=excluded.ntb_estoque_url, ntb_estoque_api_key=excluded.ntb_estoque_api_key, ativo=true;

insert into store_ntb_estoque_secrets (store_id, ntb_estoque_url, ntb_estoque_api_key, ativo)
values ('<uuid teste sertao>', 'https://app-estoque.norteparanegocios.com.br', '$(cat /tmp/chave12.txt)', true)
on conflict (store_id) do update set ntb_estoque_url=excluded.ntb_estoque_url, ntb_estoque_api_key=excluded.ntb_estoque_api_key, ativo=true;
SQL

rm /tmp/chave9.txt /tmp/chave12.txt
echo "OK: configurado (chaves nao exibidas)"
REMOTE_SCRIPT
```
Esperado: só a linha `OK: configurado (chaves nao exibidas)` — nenhum
valor de chave aparece na sua tela. Substitua `<uuid teste vieras>`/
`<uuid teste sertao>` pelos UUIDs reais anotados na Task 4.

- [ ] **Step 2b: Confirmar sem vazar valor**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"select store_id, ntb_estoque_url, ativo, ntb_estoque_api_key is not null as tem_chave from store_ntb_estoque_secrets where store_id in ('<uuid teste vieras>', '<uuid teste sertao>')\""
```
Esperado: 2 linhas, `ntb_estoque_url = https://app-estoque.norteparanegocios.com.br`
(não a URL antiga do `.vercel.app`), `ativo = t`, `tem_chave = t`.

- [ ] **Step 3: Teste real de ponta a ponta — confirmar que dispara `[SIMULADO]`, nunca a Omie real**

Criar um pedido de teste na loja de teste "Vieras e Vinhos" e fechar,
confirmando que a Ordem de Produção chega na loja de teste correspondente
do Estoque (id 9) marcada como simulada:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'bash -s' << 'REMOTE_SCRIPT'
set -e
ANON=$(grep '^ANON_KEY=' /opt/ntb-estoque-standby/.env | cut -d= -f2-)
STORE_ID='<uuid teste vieras>'
PRODUCT_ID=$(docker exec supabase-db psql -U supabase_admin -d ntb_vendas -t -A -c "select id from products where store_id='$STORE_ID' limit 1")
curl -s "https://testvendase.norteparanegocios.com.br/rest/v1/rpc/create_order_secure" \
  -X POST -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"p_table_id\":null,\"p_store_id\":\"$STORE_ID\",\"p_order_type\":\"counter\",\"p_customer_name\":\"QA Lojas Teste\",\"p_items\":[{\"product_id\":\"$PRODUCT_ID\",\"quantity\":1}]}"
REMOTE_SCRIPT
```
Anote o `order_id` retornado. Feche o pedido:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'bash -s' << 'REMOTE_SCRIPT'
set -e
ANON=$(grep '^ANON_KEY=' /opt/ntb-estoque-standby/.env | cut -d= -f2-)
curl -s "https://testvendase.norteparanegocios.com.br/rest/v1/rpc/close_counter_order_secure" \
  -X POST -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"p_order_id":"<order_id anotado acima>"}' -w "\nHTTP %{http_code}\n"
REMOTE_SCRIPT
```
Note: como o `product_id` escolhido não tem `omie_codigo` vinculado (as
lojas de teste do Vendas ainda não têm essa coluna populada — fora de
escopo aqui), a chamada real pro Estoque provavelmente retorna `skipped:
true, reason: "Nenhum item com omie_codigo vinculado"` — isso É o
resultado esperado e correto: confirma que o pipeline roda até o fim sem
erro, sem exigir que o Estoque tenha estrutura de produto configurada pra
essa loja de teste especificamente. Se quiser testar o disparo real até o
Estoque (e o gate `[SIMULADO]`), repita o teste escolhendo um `product_id`
que já tenha `omie_codigo` preenchido (`select id from products where
store_id='$STORE_ID' and omie_codigo is not null limit 1`); se nenhum
tiver, isso é esperado (a duplicação não copia `omie_codigo`, mesma
limitação já documentada de `duplicate_products_secure`) — não é
bloqueante pra fechar esta task.

- [ ] **Step 4: Limpar o pedido de teste**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -c \"delete from order_items where order_id='<order_id>'; delete from orders where id='<order_id>';\""
```

- [ ] **Step 5: Confirmar saúde do Estoque DEPOIS de tudo**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker ps --format '{{.Names}}\t{{.Status}}'"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```
Compare com o Step 1 da Task 4 — containers idênticos, `HTTP 200`.

- [ ] **Step 6: Relatório final**

Documentar: as 2 lojas de teste criadas e visíveis só pro usuário universal
liberado, cardápio completo (categorias/produtos/adicionais idênticos ao
original), ambiente fiscal travado em homologação, integração com o
Estoque configurada e testada (mesmo que sem `omie_codigo` real pra
disparar a Omie de verdade). Deixar claro que `omie_codigo` dos produtos
de teste (para disparo real ponta a ponta) fica fora de escopo — não foi
pedido, e duplicar isso exigiria decidir se copia o código real (arriscado,
afeta contagem/consumo real de estoque se algo vazar) ou gera um código
de teste dedicado (trabalho novo, não pedido).

---

## Execução

Tasks 1-3 têm componente de código (commit + push, deploy real via
Vercel) — Task 3 especificamente dispara produção. Tasks 4-7 são só SSH
em produção compartilhada com o Estoque — o controller deve executar
esses passos diretamente (subagentes não conseguem SSH nesta sessão).
Cada task com componente de servidor confirma a saúde do Estoque antes e
depois.
