# Migração NTB Vendas pro Contabo — Fase 2: Schema + Dado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Banco `ntb_vendas` no Contabo com schema completo (22 tabelas,
~60 RPCs), dado real, e Storage funcionando — corrigindo também o gap de
roteamento (`/rest/v1`) achado logo após a Fase 1.

**Architecture:** Um gateway nginx leve (`gateway-vendas`) na frente de
`rest-vendas` + um `storage-vendas` novo, ambos só na rede Docker interna;
schema recriado via replay literal das 41 migrations já versionadas; dado
copiado via `pg_dump`/`psql` (mesmo binário 17.6 dos dois lados); os 20
arquivos de Storage copiados via HTTP adaptando um script já existente no
repo.

**Tech Stack:** Docker Compose, PostgreSQL 17, PostgREST v14.12,
`supabase/storage-api:v14.12`→v1.60.4, nginx, Node.js (scripts), Next.js.

## Global Constraints

- Produção real, sem staging.
- Toda ação em servidor via SSH síncrona
  (`ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "..."`).
- **NUNCA imprimir nenhuma senha/chave/segredo em texto puro em nenhum
  lugar** (terminal, arquivo commitado, relatório). Usar `grep -c` pra
  confirmar existência de uma variável num `.env`, nunca `cat`/`grep`
  direto imprimindo o valor. Reusar segredo existente entre arquivos só
  via script remoto que nunca faz `echo`/`print` do valor.
- **Nunca editar `/opt/ntb-estoque-standby/docker-compose.yml` nem
  `/opt/ntb-estoque-standby/.env`** — toda config nova do Vendas fica em
  `/opt/ntb-vendas-infra/`.
- Confirmar a saúde do NTB Estoque (containers + HTTP 200) ANTES e DEPOIS
  de cada task.
- **A connection string do Supabase cloud (pooler) só existe hoje em
  `.env.local` deste repo, no notebook local — nunca no servidor.** Pra
  fazer o dump, ela precisa viajar do notebook até o Contabo sem nunca
  aparecer em texto em nenhum terminal, log, `history` de shell ou
  arquivo: resolvida por um script Node local que a escreve SÓ no stdout
  de um pipe, encanado direto pro `stdin` do comando SSH — o lado remoto
  lê esse stdin (`CLOUD_URL=$(cat)`) e usa a variável só dentro do mesmo
  processo shell, nunca grava em disco nem ecoa. Ela FICA visível por um
  instante como argumento de processo (`docker exec ... pg_dump
  "$CLOUD_URL"`) pra quem tiver acesso root ao próprio Contabo — mesmo
  nível de exposição já aceito na Fase 1 pro `PGRST_DB_URI` (visível via
  `docker inspect` indefinidamente); aqui é só durante a execução do
  dump. Não precisa resolver isso além do que está descrito — é um
  risco aceito, documentado, não um gap a fechar.

---

## Task 1: Gateway (`gateway-vendas`) + Storage (`storage-vendas`)

**Files:**
- Modify (no servidor, fora deste repo git):
  `/opt/ntb-vendas-infra/docker-compose.vendas.yml`
- Create (no servidor): `/opt/ntb-vendas-infra/nginx-vendas.conf`

**Interfaces:**
- Consumes: banco `ntb_vendas` e rede `supabase_default` (Fase 1).
- Produces: `127.0.0.1:8101` respondendo com prefixo `/rest/v1/` e
  `/storage/v1/` corretos — consumido pelas Tasks 2, 4 e 5.

- [ ] **Step 1: Confirmar saúde do Estoque ANTES**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker ps --format '{{.Names}}\t{{.Status}}'"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```
Anote a lista — vai comparar de novo no fim de cada task.

- [ ] **Step 2: Escrever a config do nginx**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cat > /opt/ntb-vendas-infra/nginx-vendas.conf" << 'EOF'
server {
  listen 3000;

  location /rest/v1/ {
    rewrite ^/rest/v1/(.*)$ /$1 break;
    proxy_pass http://rest-vendas:3000;
    proxy_set_header Host $host;
  }

  location /storage/v1/ {
    proxy_pass http://storage-vendas:5000/;
    proxy_set_header Host $host;
  }
}
EOF
```

- [ ] **Step 3: Reescrever `docker-compose.vendas.yml` completo**

Substitui o arquivo inteiro (o `rest-vendas` da Fase 1 continua existindo,
só perde a publicação de porta — passa a ser acessível só pela rede
interna; `gateway-vendas` assume a porta `8101`):

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

  storage-vendas:
    image: supabase/storage-api:v1.60.4
    container_name: storage-vendas
    restart: unless-stopped
    networks:
      - supabase_default
    environment:
      ANON_KEY: ${ANON_KEY}
      SERVICE_KEY: ${SERVICE_ROLE_KEY}
      POSTGREST_URL: http://rest-vendas:3000
      PGRST_JWT_SECRET: ${JWT_SECRET}
      DATABASE_URL: postgres://supabase_storage_admin:${POSTGRES_PASSWORD}@db:54322/ntb_vendas
      FILE_SIZE_LIMIT: "52428800"
      STORAGE_BACKEND: file
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: ntbvendas
      REGION: local
      ENABLE_IMAGE_TRANSFORMATION: "false"
    volumes:
      - storage-vendas-data:/var/lib/storage

  gateway-vendas:
    image: nginx:alpine
    container_name: gateway-vendas
    restart: unless-stopped
    networks:
      - supabase_default
    volumes:
      - ./nginx-vendas.conf:/etc/nginx/conf.d/default.conf:ro
    ports:
      - "127.0.0.1:8101:3000"
    depends_on:
      - rest-vendas
      - storage-vendas

networks:
  supabase_default:
    external: true

volumes:
  storage-vendas-data:
EOF
```

- [ ] **Step 4: Subir (recria `rest-vendas` sem porta publicada, cria os 2 novos)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-vendas-infra && docker compose -f docker-compose.vendas.yml --env-file /opt/ntb-estoque-standby/.env up -d"
```
Esperado: `rest-vendas` recriado (perde a porta), `storage-vendas` e
`gateway-vendas` criados.

- [ ] **Step 5: Confirmar o gap do prefixo está corrigido**

```bash
sleep 3
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker ps --filter name=vendas --format '{{.Names}}\t{{.Status}}'"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "curl -s -o /dev/null -w 'raiz -> HTTP %{http_code}\n' http://127.0.0.1:8101/rest/v1/"
```
Esperado: os 3 containers `Up`; `HTTP` **não** é mais `404` — o PostgREST
responde algo (provavelmente uma lista OpenAPI vazia de rotas, já que
`ntb_vendas` ainda não tem tabela — isso é esperado e diferente de erro
de conexão recusada). Se der `Connection refused`, o `gateway-vendas` não
subiu certo — cheque `docker logs gateway-vendas` antes de prosseguir.

- [ ] **Step 6: Confirmar saúde do Estoque DEPOIS**

Repita o Step 1 — lista de containers e `HTTP 200` idênticos.

---

## Task 2: Replay do schema (41 migrations)

**Files:**
- Nenhum arquivo neste repo modificado — as migrations já existem,
  só são aplicadas.

**Interfaces:**
- Consumes: `ntb_vendas` com `storage-vendas` já de pé (Task 1) — o
  schema `storage` precisa existir antes da migration 006.
- Produces: as 22 tabelas + RPCs prontas, consumidas pelas Tasks 3, 4, 5.

- [ ] **Step 1: Confirmar saúde do Estoque ANTES** (mesmo comando da Task 1, Step 1/6)

- [ ] **Step 2: Confirmar que o schema `storage` já existe em `ntb_vendas`**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"select count(*) from information_schema.schemata where schema_name='storage'\""
```
Esperado: `1`. Se for `0`, o `storage-vendas` ainda não terminou de
bootstrapar — espere alguns segundos e tente de novo antes de continuar
(ele roda suas próprias migrations internas na primeira subida).

- [ ] **Step 3: Copiar as 41 migrations pro servidor e aplicar em ordem**

```bash
scp -i ~/.ssh/notebook_contabo_key "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas/supabase/migrations/"*.sql root@185.193.66.240:/opt/ntb-vendas-infra/migrations/
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'bash -s' << 'REMOTE_SCRIPT'
set -e
cd /opt/ntb-vendas-infra/migrations
for f in $(ls *.sql | sort); do
  echo "== aplicando $f =="
  docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -v ON_ERROR_STOP=1 < "$f"
done
echo "OK: todas as migrations aplicadas"
REMOTE_SCRIPT
```
`ON_ERROR_STOP=1` garante que o script para no primeiro erro real (em
vez de seguir aplicando migrations fora de ordem sobre um schema
quebrado) — se parar no meio, corrija o problema e re-rode só a partir
do arquivo que falhou (as migrations anteriores já rodaram e são
idempotentes, não tem problema rodar de novo, mas não é necessário).

- [ ] **Step 4: Confirmar as 22 tabelas e os 4 buckets**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"select count(*) from information_schema.tables where table_schema='public'\""
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"select id from storage.buckets order by id\""
```
Esperado: `22` na primeira; 4 linhas na segunda —
`fiscal-documentos`, `product-images`, `store-certificates`,
`store-logos`.

- [ ] **Step 5: Confirmar saúde do Estoque DEPOIS**

---

## Task 3: Dado real (dump/restore)

**Files:**
- Nenhum arquivo neste repo modificado.

**Interfaces:**
- Consumes: schema pronto em `ntb_vendas` (Task 2).
- Produces: `ntb_vendas` com dado real, consumido pela Task 5 (QA).

- [ ] **Step 1: Confirmar saúde do Estoque ANTES**

- [ ] **Step 2: Contar as linhas no Supabase cloud (baseline, guarde os números)**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
node scripts/db.mjs "select 'stores' t, count(*) from stores union all select 'products', count(*) from products union all select 'categories', count(*) from categories union all select 'store_users', count(*) from store_users union all select 'universal_users', count(*) from universal_users union all select 'orders', count(*) from orders union all select 'order_items', count(*) from order_items union all select 'product_option_groups', count(*) from product_option_groups union all select 'product_options', count(*) from product_options union all select 'tables', count(*) from tables union all select 'fiscal_notas', count(*) from fiscal_notas order by 1"
```
Esperado (valores confirmados hoje mais cedo, podem ter mudado
ligeiramente com uso real desde então — use os números que saírem agora
como baseline, não os de hoje cedo): `stores=17, products=3224,
categories=123, store_users=54, universal_users=1, orders=277,
order_items=667, product_option_groups=7, product_options=27,
tables=311, fiscal_notas=6` (aproximado).

- [ ] **Step 3: Dump do cloud → arquivo no servidor (connection string nunca impressa)**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
node -e '
const fs = require("node:fs");
const env = {};
for (const line of fs.readFileSync(".env.local","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["\x27]|["\x27]$/g, "");
}
const u = new URL(env.SUPABASE_DB_URL);
const senha = decodeURIComponent(u.password);
const ref = u.hostname.replace(/^db\./, "").replace(/\.supabase\.co$/, "");
let host = "aws-1-sa-east-1.pooler.supabase.com", port = 5432;
try {
  const saved = fs.readFileSync("scripts/.pooler-host","utf8").trim();
  const [h,p] = saved.split(":");
  if (h) host = h;
  if (p) port = Number(p);
} catch {}
process.stdout.write("postgres://postgres." + ref + ":" + encodeURIComponent(senha) + "@" + host + ":" + port + "/postgres?sslmode=no-verify");
' | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'CLOUD_URL=$(cat); docker exec -i supabase-db pg_dump "$CLOUD_URL" --data-only --schema=public --disable-triggers > /tmp/vendas-data.sql; unset CLOUD_URL; wc -l /tmp/vendas-data.sql'
```
Esperado: um número de linhas > 0 no `/tmp/vendas-data.sql` (arquivo de
DADO, não de credencial — fica temporariamente no servidor, removido no
Step 6). Se o `node -e` falhar por não achar `.env.local` ou
`SUPABASE_DB_URL`, confirme que está rodando o comando de dentro deste
repo (`cd` já feito no Step 2).

- [ ] **Step 4: Restaurar em `ntb_vendas`**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -v ON_ERROR_STOP=1 < /tmp/vendas-data.sql"
```

- [ ] **Step 5: Comparar contagem — precisa bater EXATO com o Step 2**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"select 'stores' t, count(*) from stores union all select 'products', count(*) from products union all select 'categories', count(*) from categories union all select 'store_users', count(*) from store_users union all select 'universal_users', count(*) from universal_users union all select 'orders', count(*) from orders union all select 'order_items', count(*) from order_items union all select 'product_option_groups', count(*) from product_option_groups union all select 'product_options', count(*) from product_options union all select 'tables', count(*) from tables union all select 'fiscal_notas', count(*) from fiscal_notas order by 1\""
```
Compare linha a linha contra o Step 2. Qualquer divergência: pare e
investigue antes de prosseguir (não é esperado nenhuma diferença — é uma
cópia direta de dado real, uma tabela faltando ou com contagem diferente
indica erro no dump/restore, não um "gap conhecido" a ignorar).

- [ ] **Step 6: Limpar o arquivo temporário**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "rm /tmp/vendas-data.sql"
```

- [ ] **Step 7: Confirmar saúde do Estoque DEPOIS**

---

## Task 4: Storage (20 arquivos)

**Files:**
- Modify: `scripts/migrar-fotos-storage.mjs`

**Interfaces:**
- Consumes: `storage-vendas` de pé (Task 1), gateway respondendo em
  `/storage/v1/` (Task 1), `ntb_vendas` com as tabelas que referenciam
  `image_url`/`logo_url`/`file_path` já populadas (Task 3).
- Produces: os 20 arquivos reais copiados, consumido pela Task 5 (QA).

- [ ] **Step 1: Confirmar saúde do Estoque ANTES**

- [ ] **Step 2: Ler o arquivo atual por completo**

Leia `scripts/migrar-fotos-storage.mjs` (já visto hoje — baixa de uma URL
hardcoded de projeto antigo, sobe via API no projeto novo usando
`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` do `.env.local`
deste repo). O `.env.local` **já foi trocado na Fase 1** pra apontar pro
self-hosted novo (`http://127.0.0.1:8101` — mas esse endereço só existe
dentro da rede do Contabo, não é alcançável a partir do notebook local;
por isso este script PRECISA rodar via SSH no servidor, não localmente).

- [ ] **Step 3: Reescrever o script**

Substitua o conteúdo inteiro de `scripts/migrar-fotos-storage.mjs`:

```javascript
// Copia os arquivos reais do Storage do Supabase cloud pro storage-vendas
// no Contabo (Fase 2 da migração). Roda no SERVIDOR (via SSH), não local
// -- o `.env.local` deste repo, quando rodando no Contabo em
// /opt/ntb-vendas, já aponta pro backend novo desde a Fase 1.
// Uso (no Contabo): cd /opt/ntb-vendas && node scripts/migrar-fotos-storage.mjs
import fs from 'node:fs'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const NEW_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const CLOUD_URL = 'https://giiwtnddasminjxweohr.supabase.co'
const CLOUD_ANON_KEY = env.NTB_VENDAS_CLOUD_ANON_KEY

const PRIVATE_BUCKETS = new Set(['store-certificates', 'fiscal-documentos'])

async function listarObjetosCloud() {
  // Lista via Storage API do próprio cloud (não via SQL/pooler -- este
  // script roda no servidor, sem acesso ao pooler do notebook), que
  // aceita listagem por bucket com a anon key pra buckets públicos e
  // exige a service key pra privados.
  const buckets = ['product-images', 'store-logos', 'store-certificates', 'fiscal-documentos']
  const objetos = []
  for (const bucket of buckets) {
    const key = PRIVATE_BUCKETS.has(bucket) ? env.NTB_VENDAS_CLOUD_SERVICE_KEY : CLOUD_ANON_KEY
    const res = await fetch(`${CLOUD_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1000, prefix: '' }),
    })
    if (!res.ok) throw new Error(`Falha ao listar ${bucket}: ${res.status} ${await res.text()}`)
    const items = await res.json()
    for (const item of items) {
      if (item.id) objetos.push({ bucket, name: item.name, privado: PRIVATE_BUCKETS.has(bucket) })
    }
  }
  return objetos
}

async function baixar(bucket, name, privado) {
  const url = privado
    ? `${CLOUD_URL}/storage/v1/object/${bucket}/${name}`
    : `${CLOUD_URL}/storage/v1/object/public/${bucket}/${name}`
  const headers = privado
    ? { apikey: env.NTB_VENDAS_CLOUD_SERVICE_KEY, Authorization: `Bearer ${env.NTB_VENDAS_CLOUD_SERVICE_KEY}` }
    : {}
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Falha ao baixar ${bucket}/${name}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function subir(bucket, name, buffer, contentType) {
  const res = await fetch(`${NEW_URL}/storage/v1/object/${bucket}/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: buffer,
  })
  if (!res.ok) throw new Error(`Falha ao subir ${bucket}/${name}: ${res.status} ${await res.text()}`)
}

const objetos = await listarObjetosCloud()
console.log(`${objetos.length} objetos encontrados no cloud`)
for (const obj of objetos) {
  const buffer = await baixar(obj.bucket, obj.name, obj.privado)
  await subir(obj.bucket, obj.name, buffer)
  console.log(`OK: ${obj.bucket}/${obj.name} (${buffer.length} bytes)`)
}
console.log('Concluído.')
```

Isso troca a lista hardcoded de 14 itens por uma listagem real via
`POST /storage/v1/object/list/<bucket>` (API padrão do Storage do
Supabase), cobrindo os 4 buckets e os 20 objetos reais — não só
`products`/`stores`.

- [ ] **Step 4: Levar as chaves do cloud pro servidor sem imprimir, rodar o script**

O script precisa de duas chaves do projeto CLOUD
(`NTB_VENDAS_CLOUD_ANON_KEY`, `NTB_VENDAS_CLOUD_SERVICE_KEY`). A Fase 1
editou o `.env.local` **do servidor** (`/opt/ntb-vendas/.env.local`) pra
apontar pro backend novo, mas o `.env.local` **deste repo, neste
notebook**, nunca foi tocado — ele ainda tem as chaves originais do
cloud, hoje nomeadas `NEXT_PUBLIC_SUPABASE_ANON_KEY`/
`SUPABASE_SERVICE_ROLE_KEY`. É essa a fonte: leia LOCALMENTE (deste
notebook) e envie pro servidor, sem nunca ecoar o valor, usando o mesmo
padrão de script remoto da Fase 1 Task 3:

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
scp -i ~/.ssh/notebook_contabo_key scripts/migrar-fotos-storage.mjs root@185.193.66.240:/opt/ntb-vendas/scripts/migrar-fotos-storage.mjs
node -e '
const fs = require("node:fs");
const env = {};
for (const line of fs.readFileSync(".env.local","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["\x27]|["\x27]$/g, "");
}
process.stdout.write("NTB_VENDAS_CLOUD_ANON_KEY=" + (env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "") + "\nNTB_VENDAS_CLOUD_SERVICE_KEY=" + (env.SUPABASE_SERVICE_ROLE_KEY || ""));
' | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'cat >> /opt/ntb-vendas/.env.local'
```
Confirme sem imprimir valor (mesmo padrão de sempre):
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "grep -c '^NTB_VENDAS_CLOUD_ANON_KEY=\|^NTB_VENDAS_CLOUD_SERVICE_KEY=' /opt/ntb-vendas/.env.local"
```
Esperado: `2`. Se der `0` ou `1`, o `.env.local` local não tinha mais os
valores do cloud (pode ter sido editado manualmente depois da Fase 1) —
pare e peça as chaves do painel do Supabase cloud ao usuário antes de
continuar, não prossiga com chave vazia.

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-vendas && node scripts/migrar-fotos-storage.mjs"
```

- [ ] **Step 5: Confirmar contagem e integridade**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"select bucket_id, count(*) from storage.objects group by bucket_id order by 1\""
```
Esperado: 4 linhas, somando 20 objetos no total, distribuídos como
`fiscal-documentos=4, product-images=13, store-certificates=2,
store-logos=1`.

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "curl -sI http://127.0.0.1:8101/storage/v1/object/public/store-logos/\$(docker exec supabase-db psql -U supabase_admin -d ntb_vendas -tAc \"select name from storage.objects where bucket_id='store-logos' limit 1\") | grep -i content-length"
```
Compare esse `content-length` com o mesmo arquivo no cloud (já sabemos
pelo audit de hoje: bucket `store-logos` tem 1 objeto, 573KB total).

- [ ] **Step 6: Confirmar saúde do Estoque DEPOIS**

- [ ] **Step 7: Commitar a mudança do script**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
git add scripts/migrar-fotos-storage.mjs
git commit -m "chore: adapta migrar-fotos-storage.mjs pra Fase 2 (Contabo) - lista real via API em vez de lista hardcoded"
```

---

## Task 5: QA final + relatório

**Files:**
- Nenhum.

- [ ] **Step 1: Confirmar o app standby lista lojas reais**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "curl -s http://127.0.0.1:8101/rest/v1/stores?select=id,name&limit=3 -H \"apikey: \$(grep '^ANON_KEY=' /opt/ntb-estoque-standby/.env | cut -d= -f2-)\""
```
Esperado: uma resposta JSON com até 3 lojas reais (nomes de verdade,
não vazio, não erro). Isso confirma gateway → PostgREST → schema → dado,
tudo funcionando junto — a mesma chamada que a tela de login do app faz.

- [ ] **Step 2: Confirmar HTTP do app standby**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3003"
```
Esperado: `HTTP 200` (já era esperado desde a Fase 1 — aqui confirma que
continua de pé depois de toda a mudança de infra em volta dele).

- [ ] **Step 3: Comparar containers do Estoque do início (Task 1) ao fim**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker ps --format '{{.Names}}\t{{.Status}}'"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```
Único container a mais esperado: `storage-vendas` e `gateway-vendas`
(novos desta fase) — nenhum container do Estoque com `Status` diferente.

- [ ] **Step 4: Relatório final**

Documente: Fase 2 completa (schema real + dado real + storage real,
gap do prefixo `/rest/v1` corrigido), com as contagens finais batendo
exato entre cloud e Contabo (reusar os números da Task 3). Deixe claro
que o app de PRODUÇÃO ainda está na Vercel/cloud — isso é a Fase 3, que
também é responsável pelo diff/delta final de dado (linhas que mudarem
no cloud entre agora e o cutover de verdade) e pela decisão sobre o
dual-write existente pro `ntb_vendas_frio`. Confirme explicitamente que
nenhuma senha/chave foi impressa em nenhum momento da execução.

---

## Execução

Todas as 5 tasks envolvem SSH em produção real, compartilhando servidor
com o NTB Estoque — **o controller deve executar TODOS os steps
diretamente**, subagentes não conseguem SSH nesta sessão. Cada task
confirma a saúde do Estoque antes e depois.
