# Migração NTB Vendas pro Contabo — Fase 2: Schema + Dado — Design

**Data:** 2026-08-12

**Gatilho:** Fase 1 (infra) concluída e validada hoje — banco `ntb_vendas`
isolado no `supabase-db` do Contabo, `rest-vendas` (PostgREST) em
`127.0.0.1:8101`, app standby em `/opt/ntb-vendas` apontando pro backend
novo, ainda vazio. Esta fase traz o schema completo e o dado real pra
esse banco, e resolve o Storage (ainda não existia).

## Auditoria (não re-investigar)

- **Achado real, corrigido nesta fase**: o `rest-vendas` da Fase 1 está
  exposto como PostgREST puro, sem prefixo — mas `supabase-js` sempre
  chama `${URL}/rest/v1/...`. Confirmado hoje via `curl`:
  `http://127.0.0.1:8101/rest/v1/` → `404` (o Kong é quem normalmente
  adiciona esse prefixo, pulado de propósito na Fase 1 pra nunca mexer
  na config do Estoque). Sem impacto real até agora (banco vazio,
  ninguém em produção usa) — mas bloqueia o app de funcionar de
  verdade contra o backend novo, por isso entra nesta fase.
- **41 migrations no repo** (`001_schema_inicial.sql` até
  `041_telefone_emissor.sql`), cobrindo as 22 tabelas e ~60 funções
  `security definer`. Única extensão usada: `pgcrypto` (migration 001).
  Sem `pg_cron`/`pg_net`/dependência de Auth (GoTrue) — confirmado via
  grep, as únicas referências a schemas Supabase-específicos são
  `storage.buckets`/`storage.objects` (migrations 006, 009, 010, 011,
  034).
- **Self-hosted do Contabo é single-tenant**: o `supabase-storage`
  (`storage-api:v1.60.4`) que já serve o Estoque conecta via
  `DATABASE_URL` direto num banco específico (hoje `postgres`, o do
  Estoque) e cria o schema `storage` nele na primeira subida — não dá
  pra reusar a mesma instância pra dois bancos diferentes. Precisa de
  um `storage-vendas` próprio.
- **Volume de dado real (Supabase cloud, confirmado hoje)**: 17 lojas,
  3224 produtos, 123 categorias, 54 usuários de loja, 1 usuário
  universal, 277 pedidos, 667 itens, 7 grupos de adicionais, 27 opções,
  311 mesas, 6 notas fiscais — pequeno, cabe numa única transação de
  restore.
- **Storage real (Supabase cloud, confirmado hoje via query em
  `storage.objects`)**: 4 buckets — `product-images` (13 objetos,
  3.1MB), `store-logos` (1 objeto, 573KB), `store-certificates` (2
  objetos, 7.5KB, `.pfx` + metadata), `fiscal-documentos` (4 objetos,
  44KB). Total: 20 objetos, ~3.8MB — trivial.
- **`pg_dump`/`pg_restore` 17.6 já disponíveis** dentro do próprio
  container `supabase-db` (`docker exec supabase-db pg_dump --version`
  confirmado hoje) — mesma versão dos dois lados (cloud e Contabo),
  evita problema de compatibilidade de dump binário. Não precisa
  instalar nada novo.
- **Script já existente e validado no repo**:
  `scripts/migrar-fotos-storage.mjs` — já implementa exatamente o
  padrão de baixar arquivo de um Storage Supabase (URL pública) e subir
  em outro via API (`POST {URL}/storage/v1/object/...` com
  `service_role` key), usado numa migração anterior entre dois
  projetos cloud. Vai ser adaptado (não recriado do zero) pra esta
  migração.
- **Decisão já tomada com o usuário**: copiar schema+dado+storage real
  já nesta fase (não só um teste) — a Fase 3 (cutover) fica responsável
  só por um diff final (delta) das linhas que mudarem no cloud entre
  agora e o cutover de verdade, não por uma cópia completa do zero.

## Escopo desta fase

### 1. Gateway leve (`gateway-vendas`)

Container `nginx:alpine` novo, na rede `supabase_default`, substituindo
a publicação de porta que hoje vai direto pro `rest-vendas`. Roteamento
por prefixo, replicando em miniatura o que o Kong já faz pro Estoque:

```nginx
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
```

`docker-compose.vendas.yml` (o mesmo arquivo criado na Fase 1, editado
— não é um arquivo novo) passa a: (a) publicar `127.0.0.1:8101` no
`gateway-vendas` em vez do `rest-vendas`; (b) `rest-vendas` e
`storage-vendas` deixam de publicar porta no host, só ficam acessíveis
internamente pela rede `supabase_default` (mesmo princípio de segurança
já usado pro Estoque — nada além do gateway fica exposto, nem em
`127.0.0.1`).

### 2. Storage (`storage-vendas`)

Novo serviço no `docker-compose.vendas.yml`:

```yaml
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
    FILE_SIZE_LIMIT: 52428800
    STORAGE_BACKEND: file
    FILE_STORAGE_BACKEND_PATH: /var/lib/storage
    TENANT_ID: ntbvendas
    REGION: local
    ENABLE_IMAGE_TRANSFORMATION: "false"
  volumes:
    - storage-vendas-data:/var/lib/storage
```

`ENABLE_IMAGE_TRANSFORMATION: false` porque não vale a pena subir um
`imgproxy` dedicado só pra Vendas — o app não usa transformação de
imagem hoje (confirmar lendo `lib/api.ts` antes de implementar; se
usar, revisar essa decisão). Volume Docker nomeado próprio
(`storage-vendas-data`), nunca o mesmo diretório do Estoque. `role
supabase_storage_admin` já existe globalmente no cluster (mesmo
raciocínio dos grants da Fase 1) — só precisa ter os grants certos
dentro de `ntb_vendas` (o próprio `storage-api` cria e popula o schema
`storage` sozinho na primeira subida, não precisa de SQL manual pra
isso).

### 3. Schema

Replay das 41 migrations, em ordem, direto contra `ntb_vendas`:

```bash
for f in supabase/migrations/*.sql; do
  docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < "$f"
done
```

Precisa rodar **depois** do `storage-vendas` subir pela primeira vez
(schema `storage` precisa existir antes da migration 006, que faz
`insert into storage.buckets`). Cada arquivo já é idempotente
(`create table if not exists`, `drop policy if exists` + `create
policy`) — se algo falhar no meio, dá pra corrigir e re-rodar do
arquivo que falhou em diante, sem re-rodar os anteriores.

### 4. Dado

**Tabelas (`public`)**: dump/restore via `pg_dump`/`psql`, binário
já disponível dentro do container `supabase-db`:

```bash
docker exec supabase-db pg_dump "$SUPABASE_CLOUD_POOLER_URL" \
  --data-only --schema=public --disable-triggers \
  | docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas
```

`--disable-triggers` evita que os triggers/RLS (que já existem, criados
pelas migrations) interfiram durante o restore bruto — os dados
inseridos precisam bater exatamente com o que existe no cloud, sem
passar de novo pelas validações de aplicação. `$SUPABASE_CLOUD_POOLER_URL`
é a mesma connection string que `scripts/db.mjs` já usa hoje
(pooler, não o host IPv6-only direto) — lida do `.env.local` do jeito
já estabelecido nesta sessão, nunca impressa em texto puro.

**Storage (20 arquivos)**: adaptar `scripts/migrar-fotos-storage.mjs`
— em vez da lista hardcoded de 14 itens (era pra uma migração pontual
anterior), query em `storage.objects` do cloud pra listar os 20
arquivos reais dos 4 buckets, baixar de
`https://giiwtnddasminjxweohr.supabase.co/storage/v1/object/public/...`
(buckets públicos) ou via API autenticada com `service_role`
(`store-certificates`/`fiscal-documentos`, buckets privados), subir em
`http://127.0.0.1:8101/storage/v1/object/...` usando a `SERVICE_ROLE_KEY`
do self-hosted novo.

## Fora de escopo (explícito)

- Cutover do app de produção real (Vercel → Contabo) — Fase 3.
- Diff/delta final de dado antes do cutover de verdade — Fase 3 (esta
  fase copia o dado real de hoje, não um placeholder, mas não fica
  responsável por manter isso sincronizado depois).
- Desativar o Supabase cloud — Fase 4.
- Decidir o destino do dual-write existente pra `ntb_vendas_frio`
  (banco Postgres nativo separado, só `orders`/`order_items`) — só
  sinalizado, nenhuma ação nesta fase.
- `imgproxy` dedicado pro Storage do Vendas — deixa
  `ENABLE_IMAGE_TRANSFORMATION=false` por enquanto; revisar se algum
  fluxo do app depender de transformação de imagem.

## Testes

- `docker ps` confirma `gateway-vendas`, `storage-vendas`, `rest-vendas`
  todos rodando; só `gateway-vendas` publica porta no host.
- `curl http://127.0.0.1:8101/rest/v1/` responde (não mais 404) —
  confirma o gap achado hoje está corrigido.
- Contagem de linhas por tabela em `ntb_vendas` bate exatamente com o
  Supabase cloud no momento do dump (mesmo script de diff usado hoje
  pra achar os gaps do dual-write).
- `curl http://127.0.0.1:8101/storage/v1/object/public/store-logos/<arquivo>`
  retorna o mesmo arquivo (mesmo tamanho em bytes) que o Supabase cloud.
- App standby (`/opt/ntb-vendas`, já apontado pro backend novo desde a
  Fase 1) consegue listar lojas reais na tela de login — primeira
  confirmação end-to-end de que schema + dado + storage funcionam
  juntos, sem precisar migrar o app de produção pra isso.
- Confirmar que nenhum container do Estoque foi afetado (mesmo processo
  de antes/depois já usado na Fase 1).
