# Sertão Teste (NTB Vendas) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Criar uma loja de teste isolada ("Sertão Teste") visível só
pra 2 contas universais específicas, com ambiente fiscal travado em
homologação e integração de Ordem de Produção configurada pro endpoint
de teste do NTB Estoque (não afeta o cadastro real "O Sertão Vai Virar
Mar" nem nenhum relatório existente).

**Architecture:** Uma linha nova em `stores` (`is_test=true`), uma
coluna nova em `universal_users` (`pode_ver_lojas_teste`), filtro
client-side no seletor de loja da conta universal. Ver a spec completa
(cobre as duas pontas, NTB Vendas + NTB Estoque):
`/Users/joaquimsalles/Projects/norte para negocios/ntb vendas/docs/superpowers/specs/2026-08-12-sertao-teste-integracao-isolada-design.md`

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase
(Postgres cloud, projeto próprio deste sistema — NÃO o Postgres
self-hosted do Contabo usado pelo NTB Estoque).

---

## Global Constraints (aplicam a TODAS as tasks)

- **Produção real, sem staging** — este projeto não tem ambiente de
  staging; rodar local (`npm run dev`) já conecta no Supabase de
  produção real (achado documentado em `AGENTS.md`, linhas 45-52).
- **`npx tsc --noEmit`** limpo antes de qualquer commit de código
  (equivalente aqui: `npm run build`, que já valida tipos + build —
  rodar antes de commitar mudança grande, conforme `AGENTS.md`).
- **Migrations são aplicadas manualmente**: `node
  scripts/aplicar-migration.mjs <arquivo>.sql` (resolve a conexão via
  `SUPABASE_DB_URL` do `.env.local`, pooler
  `aws-1-sa-east-1.pooler.supabase.com`) — **NÃO** é o mesmo Postgres
  self-hosted do Contabo que o NTB Estoque usa; são dois bancos
  diferentes. SQL ad-hoc: `node scripts/db.mjs "select ..."`.
- **Deploy é automático via Vercel** (push em `main` já dispara deploy
  de produção, `https://ntb-vendas.vercel.app`) — diferente do NTB
  Estoque (deploy manual via SSH). Depois do push, confirmar o deploy
  terminou e o app responde (`curl -s -o /dev/null -w "HTTP
  %{http_code}\n" https://ntb-vendas.vercel.app` esperando 200) antes
  de considerar a task de deploy concluída.
- **Nenhuma automação/cron deve tocar a loja "Sertão Teste"** — só ação
  manual de teste do usuário/Ramon.
- **Depende do Plano B** (repo NTB Estoque,
  `docs/superpowers/plans/2026-08-12-sertao-teste-estoque.md`) já ter
  rodado a migration que cria `lojas.integracao_teste_api_key` e gerado
  um valor pra loja Sertão ANTES da Task 4 deste plano (configuração de
  `store_ntb_estoque_secrets`) — se o Plano B ainda não rodou, pule a
  Task 4 por último e volte quando a chave existir.

---

## Task 1: Migration — `stores.is_test` + `universal_users.pode_ver_lojas_teste`

**Files:**
- Create: `supabase/migrations/042_sertao_teste_lojas_teste.sql`

**Step 1: Escrever a migration**

```sql
-- Sertão Teste (2026-08-12) — ver docs/superpowers/specs/
-- 2026-08-12-sertao-teste-integracao-isolada-design.md. Loja de teste
-- isolada, visível só pra contas universais com permissão explícita.

alter table stores add column if not exists is_test boolean not null default false;

alter table universal_users add column if not exists pode_ver_lojas_teste boolean not null default false;
```

**Step 2: Aplicar**

```bash
node scripts/aplicar-migration.mjs 042_sertao_teste_lojas_teste.sql
```

**Step 3: Confirmar via SQL direto**

```bash
node scripts/db.mjs "select column_name from information_schema.columns where table_name='stores' and column_name='is_test'"
node scripts/db.mjs "select column_name from information_schema.columns where table_name='universal_users' and column_name='pode_ver_lojas_teste'"
```
Esperado: 1 linha em cada.

**Step 4: Commit**

```bash
git add supabase/migrations/042_sertao_teste_lojas_teste.sql
git commit -m "feat: colunas is_test (stores) e pode_ver_lojas_teste (universal_users)"
```

---

## Task 2: RPC de login universal retorna `pode_ver_lojas_teste`

**Depende da Task 1.**

**Files:**
- Create: `supabase/migrations/043_rpc_universal_retorna_permissao_teste.sql`
- Modify: `types/index.ts` (`UniversalUser`, linha ~295)
- Modify: `lib/api.ts` (não deveria precisar mudar `authenticateUniversalUser`,
  ela já repassa `data.user` inteiro — só confirmar lendo o código real)

**Step 1: Ler `supabase/migrations/015_universal_login.sql` inteiro**,
confirmar o corpo exato de `authenticate_universal_user_secure` antes
de escrever o `create or replace function`.

**Step 2: Nova migration recriando a function com o campo extra**

```sql
-- Sertão Teste (2026-08-12): RPC de login universal precisa devolver
-- pode_ver_lojas_teste pro client saber filtrar a lista de lojas
-- (universal_users não tem policy de leitura direta -- só via RPC).
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
    'user', jsonb_build_object(
      'id', v_user.id, 'name', v_user.name, 'email', v_user.email,
      'pode_ver_lojas_teste', v_user.pode_ver_lojas_teste
    )
  );
end;
$$;

grant execute on function public.authenticate_universal_user_secure(text, text) to anon, authenticated;
```

**Step 3: Aplicar e confirmar**

```bash
node scripts/aplicar-migration.mjs 043_rpc_universal_retorna_permissao_teste.sql
```

**Step 4: Também precisa verificar `fetchUniversalUserById`**

O restore de sessão persistida (`StoreModule.tsx`, ~linha 5126) chama
`fetchUniversalUserById(saved.userId)` — leia onde essa função está
definida (`lib/api.ts`, procure `fetchUniversalUserById`) e a RPC/query
que ela usa por trás. Se for outra RPC separada (não a de login), ela
TAMBÉM precisa devolver `pode_ver_lojas_teste` — mas como esse ponto
específico do código resolve uma loja JÁ ESCOLHIDA antes (não lista
todas as lojas), pode não ser estritamente necessário pra Task 3 funcionar.
Confirme lendo o código real e decida; documente a decisão no relatório
da task.

**Step 5: Adicionar o campo ao tipo `UniversalUser`**

`types/index.ts`, interface `UniversalUser` (linha ~295): adicionar
`pode_ver_lojas_teste: boolean`.

**Step 6: `npm run build`**

**Step 7: Commit**

```bash
git add supabase/migrations/043_rpc_universal_retorna_permissao_teste.sql types/index.ts
git commit -m "feat: RPC de login universal retorna pode_ver_lojas_teste"
```

---

## Task 3: Filtrar lojas de teste no seletor de loja

**Depende da Task 2.**

**Files:**
- Modify: `types/index.ts` (`Store`, linha ~27 — adicionar `is_test?: boolean`)
- Modify: `components/modules/StoreModule.tsx` (componente `StoreLogin`)

**Step 1: Ler `components/modules/StoreModule.tsx` inteiro na região do
componente `StoreLogin`** (por volta das linhas 40-190 na versão lida
hoje, pode ter mudado — confirme antes de editar).

**Step 2: Adicionar `is_test?: boolean` ao tipo `Store`** em
`types/index.ts` (linha ~27).

**Step 3: Estender o filtro do `useEffect` que popula `stores`**

Onde hoje é (~linha 117-124):
```ts
useEffect(() => {
    if (!universalUser) return;
    setIsLoadingStores(true);
    fetchAllStores().then((data) => {
        setStores(data.filter(s => s.is_active));
        setIsLoadingStores(false);
    });
}, [universalUser]);
```

Trocar por:
```ts
useEffect(() => {
    if (!universalUser) return;
    setIsLoadingStores(true);
    fetchAllStores().then((data) => {
        // Sertão Teste (2026-08-12): loja marcada is_test só aparece pra
        // conta universal com pode_ver_lojas_teste=true -- filtro
        // client-side, mesmo padrão de autorização já usado neste
        // componente (RLS é permissiva em toda a tabela stores).
        setStores(data.filter(s => s.is_active && (!s.is_test || universalUser.pode_ver_lojas_teste)));
        setIsLoadingStores(false);
    });
}, [universalUser]);
```

**Step 4: `npm run build`**

**Step 5: Testar via `scripts/db.mjs`** (sem navegador neste ambiente):
confirme que uma linha com `is_test=true` existe (mesmo que ainda não
seja a Sertão Teste de verdade — pode testar com uma loja fictícia
temporária e reverter, OU aguardar a Task 5 criar a loja real e testar
o filtro nela diretamente).

**Step 6: Commit**

```bash
git add types/index.ts "components/modules/StoreModule.tsx"
git commit -m "feat: esconder lojas de teste do seletor pra quem não tem permissão"
```

---

## Task 4: Travar ambiente fiscal em homologação pra lojas de teste

**Depende da Task 3.**

**Files:**
- Modify: componente de configuração fiscal da loja (localizar — procure
  por `store_fiscal_config`/`ambiente` em `components/`, provavelmente
  dentro de `StoreAdminView` ou um módulo de configurações fiscais)

**Step 1: Localizar o componente real**

```bash
grep -rln "ambiente.*homologacao\|updateStoreFiscalConfig" components/ | grep -v node_modules
```

Leia o componente encontrado por completo.

**Step 2: Quando a loja for de teste, travar o seletor**

Adicione a lógica: se `store.is_test` for `true`, desabilite (ou
esconda, decida lendo o layout real) a opção de trocar `ambiente` pra
`producao` — o campo deve continuar sempre mostrando/aplicando
`homologacao`. Ler o componente real primeiro pra decidir a forma
exata (select `disabled` com tooltip explicando, vs. esconder o campo
inteiro e mostrar um texto fixo "Homologação (loja de teste)").

**Step 3: `npm run build`**

**Step 4: Commit**

```bash
git add <arquivo(s) do componente fiscal>
git commit -m "feat: loja de teste sempre em ambiente de homologação fiscal"
```

---

## Task 5: Criar a loja "Sertão Teste" + configurar integração

**Depende das Tasks 1-4 E do Plano B (NTB Estoque) já ter aplicado sua
migration e gerado a chave de teste.** Se a chave do Plano B ainda não
existir, pare aqui e retome depois.

**Files:** nenhum (dado, não código).

**Step 1: Descobrir o CNPJ da loja real "O Sertão Vai Virar Mar"**

```bash
node scripts/db.mjs "select id, name, cnpj from stores where name ilike '%sertao%' or name ilike '%sertão%'"
```

**Step 2: Criar a loja de teste** (SQL direto, via `scripts/db.mjs` —
confirme que esse script permite INSERT, não só SELECT; se não
permitir, use `node scripts/aplicar-migration.mjs` com um arquivo
`.sql` de dado, mesmo padrão de outras migrations de seed já existentes
no repo, ex: `002_seed_demo.sql`):

```sql
insert into stores (name, slug, cnpj, is_active, is_test, config)
values ('Sertão Teste', 'sertao-teste', '<CNPJ da loja real, achado no Step 1>', true, true, '{}'::jsonb)
returning id;
```

Guarde o `id` retornado.

**Step 3: Configurar `store_fiscal_config` pra essa loja, ambiente homologação**

Confirme o schema exato de `store_fiscal_config`
(`supabase/migrations/024_config_emissor_fiscal.sql`) antes de escrever
o INSERT — provavelmente precisa de `store_id` + `ambiente` no mínimo,
mais colunas com default aceitável.

**Step 4: Configurar `store_ntb_estoque_secrets`**

```sql
insert into store_ntb_estoque_secrets (store_id, ntb_estoque_url, ntb_estoque_api_key)
values ('<id da loja de teste>', 'https://app-estoque.norteparanegocios.com.br/api/integracao/ordem-producao-teste', '<chave de teste gerada no Plano B>');
```

**IMPORTANTE**: note que `ntb_estoque_url` aqui já inclui o path
completo até `/ordem-producao-teste` (diferente das lojas reais, que
guardam só a URL base — confirme lendo `triggerOrdemProducao()` em
`lib/api.ts` pra ver se ele espera URL base + monta o path, ou se
espera a URL completa já pronta; ajuste o valor inserido conforme o que
o código realmente espera, não o que este plano presume).

**Step 5: Ativar `pode_ver_lojas_teste` nas 2 contas**

```sql
update universal_users set pode_ver_lojas_teste = true where email in ('<email do usuário>', '<email do Ramon>');
```
(confirme os emails reais antes de rodar — pergunte ao controller se
não tiver certeza, não adivinhe.)

**Step 6: Escrever relatório** com os valores reais usados (id da loja,
URLs, confirmação de que os 2 emails corretos foram atualizados) em
`.superpowers/sdd/2026-08-12-sertao-teste-vendas/task-5-report.md`.

Não precisa de commit de código nesta task (é só dado).

---

## Task 6: QA final + deploy

**Depende de todas as anteriores.**

**Step 1: `npm run build`** no repo inteiro, confirmar limpo.

**Step 2: `git push origin main`** — deploy automático via Vercel dispara.

**Step 3: Aguardar e confirmar**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://ntb-vendas.vercel.app
```
Esperado: 200.

**Step 4: Confirmar via SQL** (sem navegador): que a loja "Sertão
Teste" existe com `is_test=true`, que as 2 contas têm
`pode_ver_lojas_teste=true`, e que `store_ntb_estoque_secrets` tem a
linha certa.

**Step 5: Relatório final**, resumindo o que foi feito e pedindo pro
controller (ou pro usuário diretamente) testar de verdade no navegador
(login universal → ver se "Sertão Teste" aparece pra quem deveria e
NÃO aparece pra outra conta universal sem a permissão, se existir uma
pra testar isso).

---

## Execução

Oferecida via `superpowers:subagent-driven-development`, em uma sessão
própria neste repo (NTB Vendas) — independente da sessão que executar o
Plano B (NTB Estoque), já que são repos diferentes. **Ordem
recomendada: execute o Plano B primeiro** (cria a chave de teste que a
Task 4 deste plano precisa) — ou execute as Tasks 1-4 deste plano em
paralelo com o Plano B, e só faça a Task 5 (que depende da chave) depois
que os dois lados tiverem a base pronta.
