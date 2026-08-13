# Migração NTB Vendas pro Contabo — Fase 1: Infraestrutura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Infraestrutura de pé no Contabo pro NTB Vendas — banco novo
isolado, PostgREST próprio, app self-hosted apontando pra ela — sem
tocar em nada do que já serve o NTB Estoque em produção.

**Architecture:** Banco `ntb_vendas` novo dentro do Postgres self-hosted
já existente (`supabase-db`), um container PostgREST dedicado
(`rest-vendas`) numa porta local própria, e a cópia standby do app
(`/opt/ntb-vendas/`, já existente) promovida a apontar pra essa cadeia
nova. Ver spec completa: `docs/superpowers/specs/
2026-08-12-migracao-contabo-fase1-infra-design.md`.

**Tech Stack:** Docker Compose, PostgreSQL 17 (self-hosted), PostgREST
v14.12, Next.js 16 (self-hosted via systemd).

## Global Constraints

- Produção real, sem staging.
- Toda ação em servidor via SSH síncrona (`ssh -i
  ~/.ssh/notebook_contabo_key root@185.193.66.240 "..."`), nunca em
  background sem monitorar.
- **NUNCA imprimir nenhuma senha/chave/segredo em texto puro em lugar
  nenhum** (terminal, arquivo commitado, relatório). Já vazou 4 vezes
  hoje nesta sessão (`SUPABASE_DB_URL`, `SERVICE_ROLE_KEY`,
  `NTB_FRIO_VENDAS_API_KEY`, senhas do Postgres nativo). Qualquer
  comando que precise ler um valor de `.env`/`.env.local` usa `grep -c`
  (só contagem) pra CONFIRMAR que existe, nunca `cat`/`grep` direto
  imprimindo o valor. Pra REUSAR um segredo existente entre arquivos,
  rodar tudo dentro de um único script remoto que faz `source`/`.` do
  arquivo original e escreve o valor direto no arquivo destino via
  redirecionamento de shell (`>>`), sem nenhum `echo "$VAR"` que
  imprima o valor no stdout capturado pela sessão local — os exemplos
  de comando abaixo já seguem esse padrão, copie exatamente.
- **Nunca editar `/opt/ntb-estoque-standby/docker-compose.yml` nem
  `/opt/ntb-estoque-standby/.env`** — toda config nova do Vendas fica em
  arquivos próprios, separados.
- Confirmar a saúde do NTB Estoque (containers + HTTP 200) ANTES e
  DEPOIS de cada task — é produção real compartilhando servidor com
  outro projeto real.
- `rm -rf .next` na Task 3 é seguro (só apaga build cache do Next.js,
  regenerado por `npm run build` — não apaga nenhum dado nem config).

---

## Task 1: Banco `ntb_vendas` isolado, com os grants padrão do Supabase self-host

**Files:**
- Nenhum arquivo neste repo — SQL aplicado direto via SSH.

**Interfaces:**
- Produces: banco `ntb_vendas` pronto pro PostgREST (Task 2) conectar
  nele.

- [ ] **Step 1: Confirmar saúde do Estoque ANTES de qualquer mudança**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker ps --format '{{.Names}}\t{{.Status}}'"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```
Anote a lista de containers e confirme `HTTP 200` — vai comparar de
novo no final da Task 4.

- [ ] **Step 2: Criar o banco**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d postgres -c 'create database ntb_vendas owner supabase_admin;'"
```
Esperado: `CREATE DATABASE`.

- [ ] **Step 3: Aplicar os grants padrão do Supabase self-host DENTRO do banco novo**

Estes grants são o padrão real usado pelo template oficial do Supabase
self-host pra deixar `anon`/`authenticated`/`service_role` (roles já
existentes globalmente no cluster) funcionando no schema `public` de um
banco recém-criado, e o `authenticator` (usuário de conexão do
PostgREST) com permissão de trocar pra esses roles:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas" << 'EOF'
grant usage on schema public to postgres, anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

grant all on all tables in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
grant all on all functions in schema public to postgres, anon, authenticated, service_role;

grant anon to authenticator;
grant authenticated to authenticator;
grant service_role to authenticator;
EOF
```
Esperado: uma sequência de `GRANT`/`ALTER DEFAULT PRIVILEGES` sem erro.
Se `grant anon to authenticator` (ou as duas linhas seguintes) falhar
com "role already has membership" isso é inofensivo — significa que já
tinha sido concedido antes (improvável num banco recém-criado, mas não
é erro fatal, só um aviso).

- [ ] **Step 4: Confirmar**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c '\l' | grep ntb_vendas"
```
Esperado: uma linha listando `ntb_vendas`.

- [ ] **Step 5: Confirmar saúde do Estoque DEPOIS (nada deve ter mudado)**

Repita o Step 1 — a lista de containers e o `HTTP 200` devem ser
idênticos.

---

## Task 2: PostgREST dedicado (`rest-vendas`), porta própria

**Files:**
- Create (no servidor, fora deste repo git): `/opt/ntb-vendas-infra/docker-compose.vendas.yml`

**Interfaces:**
- Consumes: banco `ntb_vendas` (Task 1).
- Produces: PostgREST respondendo em `127.0.0.1:8101`, consumido pela
  Task 3.

- [ ] **Step 1: Confirmar a porta 8101 está livre**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "ss -tlnp | grep 8101"
```
Esperado: saída vazia (porta livre). Se não estiver vazia, pare e
escolha outra porta (ex: 8102) — não prossiga com uma porta ocupada.

- [ ] **Step 2: Criar o diretório e o arquivo compose novo**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "mkdir -p /opt/ntb-vendas-infra"
```

Conteúdo exato de `/opt/ntb-vendas-infra/docker-compose.vendas.yml`
(sem nenhum segredo hardcoded — tudo vem de variáveis de ambiente
resolvidas no momento do `docker compose up`):

```yaml
services:
  rest-vendas:
    image: postgrest/postgrest:v14.12
    container_name: rest-vendas
    restart: unless-stopped
    networks:
      - supabase_default
    environment:
      PGRST_DB_URI: postgres://authenticator:${POSTGRES_PASSWORD}@db:54322/ntb_vendas
      PGRST_DB_SCHEMAS: public
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: ${JWT_SECRET}
    ports:
      - "127.0.0.1:8101:3000"

networks:
  supabase_default:
    external: true
```

Escreva esse arquivo no servidor via SSH (heredoc, sem passar pelo seu
terminal local):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cat > /opt/ntb-vendas-infra/docker-compose.vendas.yml" << 'EOF'
services:
  rest-vendas:
    image: postgrest/postgrest:v14.12
    container_name: rest-vendas
    restart: unless-stopped
    networks:
      - supabase_default
    environment:
      PGRST_DB_URI: postgres://authenticator:${POSTGRES_PASSWORD}@db:54322/ntb_vendas
      PGRST_DB_SCHEMAS: public
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: ${JWT_SECRET}
    ports:
      - "127.0.0.1:8101:3000"

networks:
  supabase_default:
    external: true
EOF
```

- [ ] **Step 3: Subir o container, resolvendo as variáveis a partir do `.env` principal (sem nunca imprimir o valor)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-vendas-infra && docker compose -f docker-compose.vendas.yml --env-file /opt/ntb-estoque-standby/.env up -d"
```
Esperado: `Container rest-vendas Started` (ou `Created`/`Started`).

- [ ] **Step 4: Confirmar saudável e respondendo**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker ps --filter name=rest-vendas --format '{{.Names}}\t{{.Status}}'"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:8101/"
```
Esperado: container listado como `Up`, e a chamada HTTP retorna um
código de resposta (200 ou algo no formato OpenAPI do PostgREST — o
importante é NÃO ser erro de conexão recusada). Se der "Connection
refused", o container não subiu corretamente — investigue `docker logs
rest-vendas` antes de prosseguir.

- [ ] **Step 5: Confirmar saúde do Estoque (nada deve ter mudado)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker ps --format '{{.Names}}\t{{.Status}}'"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```
Compare contra o Step 1 da Task 1 — mesma lista de containers (mais o
`rest-vendas` novo), `supabase-rest`/`supabase-db` do Estoque
inalterados, `HTTP 200`.

---

## Task 3: Promover a cópia standby do app

**Files:**
- Modify (no servidor, fora deste repo git): `/opt/ntb-vendas/.env.local`

**Interfaces:**
- Consumes: PostgREST em `127.0.0.1:8101` (Task 2).

- [ ] **Step 1: Atualizar o código pro último commit**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-vendas && git pull"
```
Esperado: `Already up to date` (já era um clone limpo, confirmado hoje)
ou uma lista de arquivos atualizados, sem conflito.

- [ ] **Step 2: Trocar `NEXT_PUBLIC_SUPABASE_URL` e as chaves — SEM imprimir os valores em nenhum momento**

Isso precisa: (a) apagar a linha antiga de `NEXT_PUBLIC_SUPABASE_URL`
(que aponta pro Supabase cloud), (b) escrever a URL nova, (c) copiar
`ANON_KEY`/`SERVICE_ROLE_KEY` do `.env` principal do compose pro
`.env.local` do app, trocando os nomes de variável
(`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`). Tudo
isso roda num ÚNICO script remoto, que nunca faz `echo`/`print` de
nenhum valor — só lê de um arquivo e escreve no outro via redirecionamento
de shell:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'bash -s' << 'REMOTE_SCRIPT'
set -e
cd /opt/ntb-vendas

# Remove as linhas antigas de URL/chaves do Supabase cloud (se existirem)
sed -i '/^NEXT_PUBLIC_SUPABASE_URL=/d;/^NEXT_PUBLIC_SUPABASE_ANON_KEY=/d;/^SUPABASE_SERVICE_ROLE_KEY=/d' .env.local

# Escreve a URL nova (não é segredo, pode aparecer no comando)
echo "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8101" >> .env.local

# Copia ANON_KEY/SERVICE_ROLE_KEY do .env principal SEM nunca imprimir o valor:
# lê a linha certa do arquivo de origem, troca só o nome da variável, escreve
# direto no destino -- tudo dentro do processo sed/awk, nunca passa por stdout
# visível nesta sessão.
awk -F'=' '/^ANON_KEY=/{print "NEXT_PUBLIC_SUPABASE_ANON_KEY=" substr($0, index($0,"=")+1)}' /opt/ntb-estoque-standby/.env >> .env.local
awk -F'=' '/^SERVICE_ROLE_KEY=/{print "SUPABASE_SERVICE_ROLE_KEY=" substr($0, index($0,"=")+1)}' /opt/ntb-estoque-standby/.env >> .env.local

echo "OK: .env.local atualizado (valores não exibidos)"
REMOTE_SCRIPT
```

Esperado: só a linha `OK: .env.local atualizado (valores não
exibidos)` aparece na sua tela — nenhum valor de chave. Se qualquer
outra coisa que pareça um JWT (`eyJ...`) aparecer na sua tela, PARE e
reporte antes de continuar — o script não deveria vazar isso.

- [ ] **Step 2b: Confirmar (sem vazar valor) que as 3 linhas foram escritas**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "grep -c '^NEXT_PUBLIC_SUPABASE_URL=\|^NEXT_PUBLIC_SUPABASE_ANON_KEY=\|^SUPABASE_SERVICE_ROLE_KEY=' /opt/ntb-vendas/.env.local"
```
Esperado: `3`.

- [ ] **Step 3: Rebuild e restart**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-vendas && rm -rf .next && npm ci && npm run build"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "systemctl restart ntb-vendas"
```
`rm -rf .next` é seguro aqui — só apaga o cache de build do Next.js
(HTML/JS compilados), nunca dado nem config; `npm run build` regenera
tudo do zero a partir do código-fonte. É exatamente o mesmo motivo já
documentado no `AGENTS.md` do NTB Estoque pra evitar build stale.

- [ ] **Step 4: Confirmar**

```bash
sleep 5
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3003 2>&1 || ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3003"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "journalctl -u ntb-vendas -n 30 --no-pager"
```
Esperado: `HTTP 200` (o Next.js sobe normalmente mesmo com o banco
vazio — a página de login/estática não depende de tabela nenhuma
existir). Nos logs: **não deve mais aparecer** `Failed to find Server
Action` (esse era sintoma do build antigo, resolvido pelo rebuild do
Step 3). É esperado e OK aparecer erro de "relation does not exist"
(tabela não existe) SE algum log tentar uma query real — isso é
diferente de erro de conexão recusada (`ECONNREFUSED`/`fetch failed`),
que SIM seria um problema real de configuração — se aparecer isso
último, pare e investigue a Task 2 (PostgREST) antes de prosseguir.

---

## Task 4: QA final — confirmar isolamento total do Estoque

**Files:**
- Nenhum — task de validação.

- [ ] **Step 1: Comparar a lista de containers do início ao fim**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker ps --format '{{.Names}}\t{{.Status}}'"
```
Compare linha a linha contra a lista anotada no Step 1 da Task 1 — a
única diferença esperada é o `rest-vendas` a mais. Nenhum container do
Estoque deve ter `Status` diferente (ex: um "Up 2 minutes" onde antes
era "Up 12 days" indicaria que foi reiniciado sem necessidade).

- [ ] **Step 2: Confirmar o Estoque em produção real, não só os containers**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```
Esperado: `HTTP 200`.

- [ ] **Step 3: Confirmar o Vendas standby de pé**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3003"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "systemctl is-active ntb-vendas rest-vendas 2>/dev/null; docker inspect -f '{{.State.Status}}' rest-vendas"
```
Esperado: `HTTP 200`, `rest-vendas` container `running`.

- [ ] **Step 4: Relatório final**

Documente no relatório: confirmação de que a Fase 1 está completa
(banco `ntb_vendas` isolado e com grants corretos; `rest-vendas`
respondendo em `127.0.0.1:8101`; app standby promovido, apontando pro
banco novo, sem mais o erro de build stale) e que o banco ainda está
**vazio** (schema/dado é a Fase 2, próximo passo natural, ainda não
iniciado nesta rodada). Confirme explicitamente que nenhuma senha/chave
foi impressa em nenhum momento da execução (revise os logs de comando
desta sessão antes de fechar o relatório).

---

## Execução

Todas as 4 tasks envolvem SSH em produção real, compartilhando servidor
com o NTB Estoque (outro projeto real, em produção) — **o controller
deve executar TODOS os steps diretamente**, subagentes não conseguem
SSH nesta sessão. Cada task confirma a saúde do Estoque antes e depois,
não só a do Vendas — isso não é opcional, é a rede de segurança contra
efeito colateral num servidor compartilhado.
