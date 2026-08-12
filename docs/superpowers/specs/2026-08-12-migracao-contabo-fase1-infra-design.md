# Migração NTB Vendas pro Contabo — Fase 1: Infraestrutura — Design

**Data:** 2026-08-12

**Gatilho:** o usuário quer migrar o NTB Vendas inteiro do Supabase
cloud (`giiwtnddasminjxweohr.supabase.co`) pro self-hosted no Contabo
(mesmo servidor que já hospeda o NTB Estoque). Projeto grande,
decomposto em 4 fases — esta é a **Fase 1: infraestrutura pronta**
(banco + PostgREST + app rodando, ainda sem dado nem envs trocadas).

## Auditoria (não re-investigar)

- **Stack self-hosted do Contabo já é completo**: `supabase-db`
  (Postgres 17.6), `supabase-rest` (PostgREST v14.12), `supabase-auth`
  (GoTrue), `supabase-storage`, `supabase-kong`, `supabase-pooler`,
  `supabase-realtime`, `supabase-studio`, `supabase-meta`,
  `supabase-imgproxy`, `supabase-edge-functions` — todos "Up (healthy)"
  há 12+ dias, servindo hoje só o NTB Estoque (banco `postgres` dentro
  do container `supabase-db`).
- **RAM real disponível**: `free -h` → `available: 2.9Gi` (métrica
  correta, considera cache reclamável — não os 585Mi "free" nem os
  1.3Gi vistos numa medição anterior mais pessimista). Um PostgREST novo
  (imagem já local, 27.4MB, Haskell, ~50-100MB de uso) cabe folgado; um
  Next.js novo (~200-500MB) também cabe, deixando margem razoável.
- **`docker-compose.yml`** real: `/opt/ntb-estoque-standby/
  docker-compose.yml` — é o template oficial do Supabase self-host, sem
  branding hardcoded (só `POOLER_TENANT_ID=ntbestoque` no `.env`).
- **`supabase-rest` hoje**: container sem porta publicada no host (só
  interno, `3000/tcp`), `PGRST_DB_SCHEMAS=public,graphql_public`,
  `PGRST_DB_URI` aponta pro banco `postgres` na porta interna `54322`.
  Roteado via Kong (`kong.yml`, bloco `rest-v1`, path `/rest/v1/`),
  Kong só escuta em `127.0.0.1:8100`/`8143` (nunca exposto
  publicamente).
- **Banco `postgres` do container**: só 4 bancos hoje (`_supabase`,
  `postgres`, `template0`, `template1`). Zero replication slots — bancos
  são totalmente isolados entre si no Postgres, criar um banco novo não
  afeta o `postgres` existente do Estoque de forma alguma.
- **NTB Estoque conecta no próprio backend self-hosted via
  `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8100`** (confirmado em
  `/opt/ntb-estoque/.env.local`) — mesmo padrão a replicar, mas via uma
  porta PRÓPRIA (não o Kong compartilhado) pra nunca arriscar tocar na
  config que já serve o Estoque em produção.
- **Já existe uma cópia do NTB Vendas rodando no Contabo**
  (`ntb-vendas.service`, Next.js 16.2.9, porta `127.0.0.1:3003`,
  clone limpo de `origin/main`, sem divergência de código) — mas hoje
  aponta pro Supabase CLOUD (não é uma migração de banco, é uma cópia
  criada em sessão anterior pra validar bugs de emissão fiscal/PDF que
  só aparecem em ambiente Node real, não serverless). Build está
  desatualizado (`Failed to find Server Action` nos logs — sintoma
  clássico de `.next` não batendo com o client servido). Esta instância
  vai ser **promovida**: mesmo processo físico, só troca de env +
  rebuild.
- **Volume de dado no Supabase cloud (irrelevante pra Fase 1, mas
  confirma que a Fase 2 será rápida)**: 17 lojas, 3224 produtos, 123
  categorias, 54 usuários de loja, 277 pedidos, 667 itens, 7 grupos de
  adicionais, 27 opções, 311 mesas, 6 notas fiscais emitidas — dataset
  pequeno.

## Decisão já tomada com o usuário

App migra pro Contabo também (não fica na Vercel apontando pro
Postgres remoto) — banco fica só acessível internamente, nunca exposto
na internet pública. Mesmo padrão de segurança já usado pelo NTB
Estoque.

## Escopo desta Fase (1 — Infraestrutura)

### 1. Banco novo, isolado

```sql
create database ntb_vendas owner supabase_admin;
```

Aplicado dentro do `supabase-db` já existente — nenhuma mudança no
banco `postgres` do Estoque.

### 2. PostgREST novo, porta própria (nunca toca no Kong/rest-v1 existente)

Novo serviço Docker (`rest-vendas`, mesma imagem
`postgrest/postgrest:v14.12` já local), na mesma rede `supabase_default`
(pra falar com `supabase-db` pelo hostname interno), publicado **só**
em `127.0.0.1:8101` (porta local nova, escolhida por não colidir com
nada já em uso — confirmar via `ss -tlnp | grep 8101` antes de aplicar).
`PGRST_DB_URI` aponta pro banco `ntb_vendas` (não `postgres`).
`PGRST_DB_SCHEMAS=public`. Adicionado como serviço extra num
`docker-compose.vendas.yml` separado (não editar o `docker-compose.yml`
principal do Estoque) — usa a rede externa `supabase_default` já
existente (`docker network` já criada pelo compose principal).

### 3. Storage — bucket novo no `supabase-storage` já existente

Um bucket dedicado (ex: `ntb-vendas-certificates`) dentro da mesma
instância de Storage que já serve o Estoque — sem precisar de uma
instância de Storage separada. Configuração via API do Storage
(`create bucket`), aplicada na Fase 2 junto com a migração de dado (não
há nada de Storage pra criar na Fase 1 além de confirmar que a
instância está saudável e acessível).

### 4. Promover a cópia standby existente

`/opt/ntb-vendas/` já é um clone limpo e atualizado — não precisa
recriar. Passos: `git pull` (garantir último commit), `.env.local`
trocado pra apontar `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8101`
(as chaves `ANON_KEY`/`SERVICE_ROLE_KEY` do self-hosted, geradas pelo
próprio stack Supabase — não as do cloud), `rm -rf .next && npm ci &&
npm run build` (resolve o build desatualizado já observado), `systemctl
restart ntb-vendas`. Nesta fase o app ainda aponta pro banco **vazio**
(`ntb_vendas`, sem schema/dado ainda) — é esperado que a aplicação não
funcione de verdade até a Fase 2; o objetivo desta fase é só confirmar
que a cadeia toda (Next.js self-hosted → PostgREST novo → Postgres
novo) responde tecnicamente (ex: uma query simples via `supabase-js`
não dá erro de conexão, mesmo que retorne vazio por falta de tabela).

## Fora de escopo desta Fase

- Schema (as 22 tabelas, RPCs, RLS) — Fase 2.
- Cópia do dado real — Fase 2.
- Troca definitiva de env em produção (a Vercel continua sendo o
  deploy real até a Fase 3 confirmar tudo funcionando) — Fase 3.
- Desativar o Supabase cloud — Fase 4, só depois de tudo validado.
- Resolver os 3 gaps do dual-write de `orders`/`order_items` — deixa de
  ser relevante depois da Fase 4 (não há mais 2 bancos pra divergir),
  não vale investigar a causa agora.

## Testes

- `docker ps` confirma `rest-vendas` rodando, "healthy".
- `curl http://127.0.0.1:8101/` (sem tabela nenhuma ainda) retorna a
  resposta padrão do PostgREST (lista de rotas vazia, formato OpenAPI),
  não erro de conexão.
- `systemctl status ntb-vendas` ativo, `curl 127.0.0.1:3003` responde
  200 (mesmo que as telas internas dêem erro de "tabela não existe" —
  isso é esperado, confirma só que o Next.js está de pé com a env nova).
- Confirmar que `docker ps`/`ss -tlnp` do Estoque não mudou nada — nem
  uma porta a mais, nem um container reiniciado.
