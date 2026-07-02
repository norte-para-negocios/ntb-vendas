# Pendente: aplicar migrations no banco (fazer no computador com as chaves)

Checklist objetivo. Todo o código já está pronto e commitado no `main` — só
falta rodar isso contra o banco Supabase real.

## 0. Pré-requisito: `.env.local`

Criar `.env.local` na raiz do repo (`ntb-vendas/`) com:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=...
```

`SUPABASE_DB_URL` é o que falta pra rodar migration — sem ele
`node scripts/aplicar-migration.mjs` não conecta em lugar nenhum.

**Atenção:** `NEXT_PUBLIC_SUPABASE_URL`/`_ANON_KEY` já têm um fallback
hardcoded em `lib/supabaseClient.ts` (mesmo banco). Ou seja, mesmo sem
`.env.local`, o app já roda local conectado no banco **real de produção**
(as 7 lojas reais citadas no `AGENTS.md`, incluindo "Bistrô Demo" e
"Japanese"). Isso não muda nada aqui, é só um lembrete: qualquer teste
manual depois de aplicar as migrations já vai estar mexendo com o banco de
verdade.

## 1. Aplicar as 4 migrations pendentes, NESSA ORDEM

```bash
node scripts/aplicar-migration.mjs 006_fiscal_certificado.sql
node scripts/aplicar-migration.mjs 007_seguranca_pedidos.sql
node scripts/aplicar-migration.mjs 008_seguranca_login.sql
node scripts/aplicar-migration.mjs 009_indices_realtime_e_soft_delete.sql
```

Esperado em cada uma: `MIGRATION APLICADA.` no output. Se qualquer uma
falhar, **parar e não rodar a próxima** (009 depende de `orders`/
`order_items` já existirem no formato certo, e por convenção do projeto as
migrations são sequenciais — não pular numeração).

### O que cada uma faz

| Migration | O que cria/muda |
|---|---|
| **006** | Bucket privado `store-certificates` + tabela `store_fiscal_certificates` (metadados legíveis) + `store_fiscal_certificate_secrets` (senha, write-only — sem policy de SELECT, de propósito). |
| **007** | Rate-limit de PIN em `open_table_session` (5 tentativas/5min); function nova `create_order_secure` (preço do pedido validado no servidor, nunca confia no que o client manda); CHECK constraints (`price >= 0`, `quantity > 0`). |
| **008** | Rate-limit de login (5 tentativas/5min) via functions novas `authenticate_admin_secure`/`authenticate_store_user_secure`. |
| **009** | Índice composto pro histórico de vendas; `order_items.store_id` denormalizado (+ trigger que mantém sincronizado) pra filtrar Realtime por loja; policy de DELETE pro bucket do certificado. |

**Importante — 007 e 008 não são só "melhoria", são bloqueantes.** O código
em `lib/api.ts` (já commitado) chama `create_order_secure`,
`authenticate_admin_secure` e `authenticate_store_user_secure` via
`supabase.rpc(...)`. Enquanto essas migrations não forem aplicadas, **login
de admin/lojista e criação de pedido vão falhar** com erro de "function not
found" — o app já está esperando essas RPCs existirem.

## 2. Verificação rápida depois de aplicar

```bash
node scripts/db.mjs "select proname from pg_proc where proname in ('create_order_secure','authenticate_admin_secure','authenticate_store_user_secure','open_table_session')"
```
Esperado: as 4 funções na resposta.

```bash
node scripts/db.mjs "select column_name from information_schema.columns where table_name='order_items' and column_name='store_id'"
```
Esperado: 1 linha (`store_id`).

```bash
node scripts/db.mjs "select id, public from storage.buckets where id='store-certificates'"
```
Esperado: 1 linha, `public = false`.

## 3. Teste manual (roteiro completo já existia nos planos anteriores)

1. `npm run dev`, logar em `/loja` — confirma que `authenticate_store_user_secure`
   funciona (login continua igual pro usuário, só mudou por baixo).
2. Fazer um pedido de teste em `/c/bistro` (loja demo, **não mexer em loja
   real de cliente**) — confirma `create_order_secure`.
3. Digitar PIN errado 5x numa mesa — confirma que bloqueia por 5 min
   (mensagem "Muitas tentativas...").
4. `/painel`, editar a loja demo, subir um certificado de teste na seção
   "Certificado Digital (fiscal)" — confirma bucket + tabelas de 006.
5. Ver `npm run build` limpo (já validado localmente antes de commitar, mas
   confirmar de novo depois das migrations não custa).

## 4. Depois de tudo aplicado e testado

Atualizar `AGENTS.md` removendo os avisos de "migration pendente de
aplicar" nas seções "Banco de dados" e "Backlog / Próximos passos" (hoje
eles dizem explicitamente que 007/008/009 não foram aplicadas — isso fica
desatualizado assim que você rodar o passo 1). Pode apagar este arquivo
(`docs/PENDENTE-aplicar-migrations.md`) depois de concluir.
