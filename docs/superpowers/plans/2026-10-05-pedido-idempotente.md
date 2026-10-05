# Pedido idempotente (anti-duplicidade) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O mesmo pedido enviado duas vezes (reenvio da fila offline depois de a resposta se perder) nunca cria dois pedidos nem imprime/cobra em dobro.

**Architecture:** Cada pedido nasce no cliente com um `client_request_id` (uuid) que viaja junto na fila offline. Uma função nova `create_order_v3` (aditiva, embrulha a `create_order_secure` sem reescrevê-la) guarda a resposta numa tabela `order_requests` e, se o mesmo id chegar de novo, devolve a resposta guardada com `duplicado: true`. Apps antigos continuam chamando `create_order_secure` sem mudança; apps novos caem nela se a v3 não existir (PGRST202).

**Tech Stack:** Postgres (migration SQL aplicada à mão no Contabo), TypeScript (`lib/api.ts`, `lib/offline/*`), testes `npx tsx scripts/testes/*.test.ts`.

**Spec:** Review independente de 04/10 (item 4 "Pedido duplicado ainda é possível") e incidente das mesas 22/8/23, que subiram em dobro às 19:34-19:45 quando as filas presas sincronizaram.

## Global Constraints

- Migration só ADITIVA: nada de alterar/derrubar `create_order_secure` (apps 1.2.83-1.2.87 e 1.0.19-1.0.23 a chamam).
- `store_id` é a fronteira de confiança (sem Supabase Auth): a v3 só devolve resposta guardada da MESMA loja.
- Nunca testar no Sertão (`4f8a9e1a-6c3d-4b2e-9f7a-8e5c1d2b3a90`). Teste só na loja ZZ Laboratório.
- Banco certo: container `supabase-db`, banco `ntb_vendas`, usuário `supabase_admin`; depois de aplicar, `NOTIFY pgrst, 'reload schema'`.
- Mensagens ao usuário em português; commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Mesmo `client_request_id` duas vezes em paralelo (duplo clique/reenvio simultâneo): só um pedido.
- Mesmo id em OUTRA loja: não devolve a resposta da primeira.
- Pedido recusado por regra (produto inválido, taxa): nada é guardado, e o reenvio corrigido funciona.
- Banco sem a migration (app novo, banco velho): cai na função antiga sem quebrar o pedido.
- `p_client_request_id` nulo (app antigo): comportamento idêntico ao de hoje.

---

### Task 1: Tabela e função `create_order_v3`

**Files:**
- Create: `supabase/migrations/162_create_order_idempotente.sql`

**Interfaces:**
- Produces: `public.create_order_v3(p_table_id uuid, p_store_id uuid, p_order_type text, p_customer_name text, p_items jsonb, p_added_by_role text, p_added_by_name text, p_client_request_id uuid) returns jsonb` (mesmo formato de `create_order_secure`, mais `duplicado: true` no reenvio).

- [ ] **Step 1: Escrever a migration**

```sql
-- 162: pedido idempotente. Aditiva: create_order_secure não muda.
begin;

create table if not exists public.order_requests (
  client_request_id uuid primary key,
  store_id uuid not null,
  order_id uuid,
  response jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists order_requests_created_at_idx on public.order_requests (created_at);
alter table public.order_requests enable row level security;
-- sem policy nenhuma: só as funções security definer abaixo leem/gravam.

create or replace function public.create_order_v3(
  p_table_id uuid, p_store_id uuid, p_order_type text, p_customer_name text,
  p_items jsonb, p_added_by_role text, p_added_by_name text, p_client_request_id uuid
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_prev jsonb;
  v_res jsonb;
begin
  if p_client_request_id is null then
    return create_order_secure(p_table_id, p_store_id, p_order_type, p_customer_name, p_items, p_added_by_role, p_added_by_name);
  end if;

  -- serializa tentativas com o mesmo id (reenvio simultâneo)
  perform pg_advisory_xact_lock(hashtextextended(p_client_request_id::text, 0));

  select response into v_prev from order_requests
   where client_request_id = p_client_request_id and store_id = p_store_id;
  if v_prev is not null then
    return v_prev || jsonb_build_object('duplicado', true);
  end if;

  v_res := create_order_secure(p_table_id, p_store_id, p_order_type, p_customer_name, p_items, p_added_by_role, p_added_by_name);

  if coalesce((v_res->>'success')::boolean, false) then
    insert into order_requests (client_request_id, store_id, order_id, response)
    values (p_client_request_id, p_store_id, nullif(v_res->>'order_id', '')::uuid, v_res)
    on conflict (client_request_id) do nothing;
  end if;

  -- limpeza barata: no máximo 50 linhas com mais de 14 dias por chamada
  delete from order_requests where ctid in (
    select ctid from order_requests where created_at < now() - interval '14 days' limit 50);

  return v_res;
end;
$$;

grant execute on function public.create_order_v3(uuid, uuid, text, text, jsonb, text, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
```

- [ ] **Step 2: Conferir o padrão de grant das funções vizinhas**

Run: `grep -n "grant execute" supabase/migrations/159_operador_valida_acoes_sensiveis.sql | head -3`
Expected: usa `to anon, authenticated` (se for diferente, copiar o mesmo padrão na migration).

- [ ] **Step 3: Aplicar no banco e testar na loja ZZ (nunca no Sertão)**

```bash
scp -i ~/.ssh/notebook_contabo_key supabase/migrations/162_create_order_idempotente.sql root@185.193.66.240:/tmp/162.sql
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -v ON_ERROR_STOP=1 < /tmp/162.sql"
```
Expected: `COMMIT` sem erro.

Teste (psql na ZZ; descobrir ids com `select id from stores where name ilike 'ZZ Lab%'`, uma mesa livre `select id from tables where store_id=<zz> and status='available' limit 1` e um produto `select id from products where store_id=<zz> and fee_type is null and available limit 1`):

```sql
-- chamada 1 e 2 com o MESMO id: 1 pedido só
select create_order_v3('<mesa>','<zz>','table',null,'[{"product_id":"<prod>","quantity":1,"notes":""}]','garcom','QA','11111111-1111-1111-1111-111111111111');
select create_order_v3('<mesa>','<zz>','table',null,'[{"product_id":"<prod>","quantity":1,"notes":""}]','garcom','QA','11111111-1111-1111-1111-111111111111');
select count(*) from order_items oi join orders o on o.id=oi.order_id where o.table_id='<mesa>';
```
Expected: segunda chamada traz `"duplicado": true` e o `count` é 1. Outra loja com o mesmo id não devolve a resposta (retorna erro de mesa inválida, não o pedido da ZZ).

- [ ] **Step 4: Limpar o teste e commitar**

Apagar o pedido de teste (`delete from orders where id=<order_id>` e a linha de `order_requests`) e devolver a mesa a `available`.

```bash
git add supabase/migrations/162_create_order_idempotente.sql
git commit -m "feat(db): create_order_v3 idempotente (order_requests)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: Cliente envia o `client_request_id` e cai na função antiga se faltar a v3

**Files:**
- Create: `lib/offline/criarPedido.ts`
- Modify: `lib/api.ts` (função `createOrder`, ~linhas 1603-1637)
- Modify: `lib/offline/sync.ts` (case `'create_order'`, ~linhas 36-46)
- Test: `scripts/testes/pedidoIdempotente.test.ts`

**Interfaces:**
- Produces: `chamarCriarPedido(payload: Record<string, unknown>): Promise<{ success: boolean; order_id?: string; message?: string; duplicado?: boolean }>` em `lib/offline/criarPedido.ts`. `payload` já traz `p_client_request_id`. Lança o erro do supabase em falha de rede (para `isNetworkError` decidir), devolve `{success:false, message}` em erro de negócio.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// rodar com: npx tsx scripts/testes/pedidoIdempotente.test.ts
import assert from 'node:assert/strict';

const chamadas: { url: string; body: any }[] = [];
let roteiro: (url: string) => { status: number; body: unknown } | 'rede' = () => ({ status: 200, body: { success: true, order_id: 'o1' } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  chamadas.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
  const r = roteiro(url);
  if (r === 'rede') throw new TypeError('Failed to fetch');
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

async function main() {
  const { chamarCriarPedido } = await import('../../lib/offline/criarPedido');
  const payload = { p_table_id: 't', p_store_id: 's', p_order_type: 'table', p_customer_name: null, p_items: [], p_added_by_role: 'garcom', p_added_by_name: 'x', p_client_request_id: '11111111-1111-1111-1111-111111111111' };

  // 1) usa a v3 e manda o id
  const r1 = await chamarCriarPedido(payload);
  assert.equal(r1.success, true);
  assert.ok(chamadas[0].url.includes('/rpc/create_order_v3'), 'chama a v3');
  assert.equal(chamadas[0].body.p_client_request_id, payload.p_client_request_id, 'o id viaja');

  // 2) banco sem a v3 (PGRST202): cai na antiga SEM o id
  chamadas.length = 0;
  roteiro = (u) => (u.includes('create_order_v3') ? { status: 404, body: { code: 'PGRST202', message: 'not found' } } : { status: 200, body: { success: true, order_id: 'o2' } });
  const r2 = await chamarCriarPedido(payload);
  assert.equal(r2.success, true);
  assert.ok(chamadas.some((c) => c.url.includes('/rpc/create_order_secure')), 'fallback para a antiga');
  assert.equal(chamadas.find((c) => c.url.includes('create_order_secure'))!.body.p_client_request_id, undefined, 'a antiga não recebe o id');

  // 3) reenvio com o mesmo payload manda o MESMO id (idempotência na fila)
  chamadas.length = 0; roteiro = () => ({ status: 200, body: { success: true, order_id: 'o1', duplicado: true } });
  const r3 = await chamarCriarPedido(payload);
  assert.equal(r3.duplicado, true);
  assert.equal(chamadas[0].body.p_client_request_id, payload.p_client_request_id);

  // 4) erro de negócio vira {success:false}, rede falha propaga
  roteiro = () => ({ status: 200, body: { success: false, message: 'Mesa inválida' } });
  assert.equal((await chamarCriarPedido(payload)).success, false);
  roteiro = () => 'rede';
  await assert.rejects(() => chamarCriarPedido(payload));

  console.log('pedidoIdempotente: todos os casos passaram');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/testes/pedidoIdempotente.test.ts`
Expected: FAIL (`Cannot find module '../../lib/offline/criarPedido'`).

- [ ] **Step 3: Implementar**

```ts
// lib/offline/criarPedido.ts
import { supabase } from '../supabaseClient';

type Resultado = { success: boolean; order_id?: string; message?: string; duplicado?: boolean };

// Chama a v3 (idempotente por p_client_request_id); se o banco ainda não tem a migration 162 (PGRST202), cai na
// create_order_secure sem o id. Rede/timeout PROPAGA (quem chama decide enfileirar); regra de negócio volta em success:false.
export async function chamarCriarPedido(payload: Record<string, unknown>): Promise<Resultado> {
  const { data, error } = await supabase.rpc('create_order_v3', payload);
  if (error && (error as { code?: string }).code === 'PGRST202') {
    const { p_client_request_id: _ignorado, ...semId } = payload;
    const r = await supabase.rpc('create_order_secure', semId);
    if (r.error) throw r.error;
    return (r.data ?? { success: false, message: 'Resposta vazia.' }) as Resultado;
  }
  if (error) throw error;
  return (data ?? { success: false, message: 'Resposta vazia.' }) as Resultado;
}
```

Em `lib/api.ts`, no `createOrder`: gerar o id uma vez, junto do `rpcPayload`, e trocar a chamada direta:

```ts
const rpcPayload = {
  p_table_id: tableId, p_store_id: storeId, p_order_type: isCounter ? 'counter' : 'table',
  p_customer_name: customerName || null, p_items: pItems,
  p_added_by_role: addedByRole, p_added_by_name: addedByName || null,
  p_client_request_id: crypto.randomUUID(),
};
// ...
const data = await chamarCriarPedido(rpcPayload);
if (!data?.success) throw new Error(data?.message || 'Erro ao criar pedido.');
return { success: true, orderId: data.order_id };
```
(remover o `if (error) throw error;` antigo; adicionar `import { chamarCriarPedido } from './offline/criarPedido';`). O `enqueue('create_order', { ...rpcPayload, localOrderId })` já leva `p_client_request_id` dentro do `rpcPayload`.

Em `lib/offline/sync.ts` (case `'create_order'`), trocar a chamada:

```ts
const { localOrderId, ...rpcPayload } = action.payload as any;
const data = await chamarCriarPedido(rpcPayload);
if (!data?.success) throw new Error(data?.message || 'Erro ao criar pedido.');
if (localOrderId && data.order_id) idMap.set(localOrderId, data.order_id);
break;
```
(adicionar `import { chamarCriarPedido } from './criarPedido';`; ações antigas da fila sem `p_client_request_id` seguem funcionando: a v3 com id nulo vira a função de sempre).

- [ ] **Step 4: Rodar teste, tsc e a regressão do Sertão**

Run: `npx tsx scripts/testes/pedidoIdempotente.test.ts && npx tsc --noEmit -p . && npx tsx scripts/testes/offlineSertao0410.test.ts`
Expected: os três passam.

- [ ] **Step 5: Registrar no portão e commitar**

O portão já roda todo `scripts/testes/*.test.ts`. Rodar `PORTAO_SO=testes bash scripts/e2e/portao-deploy.sh` e esperar `PASSOU`.

```bash
git add lib/offline/criarPedido.ts lib/api.ts lib/offline/sync.ts scripts/testes/pedidoIdempotente.test.ts
git commit -m "feat(pedido): client_request_id + create_order_v3 com fallback; fila reenvia com o mesmo id

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: Fluxo completo e versão nova (sem publicar)

**Files:**
- Modify: `desktop/package.json` (`version` → `1.2.88`), `mobile/package.json` (→ `1.0.24`), `mobile/android/app/build.gradle` (`versionCode 25`, `versionName "1.0.24"`).

- [ ] **Step 1: Portão completo no commit final**

Run: `bash scripts/e2e/portao-deploy.sh`
Expected: `PORTÃO: PASSOU` (sem execução parcial).

- [ ] **Step 2: Conferir pela API pública que um app antigo continua criando pedido**

Na ZZ: `create_order_secure` direto (sem id) cria pedido normal; limpar depois.

- [ ] **Step 3: Subir versões e commitar (NÃO publicar no feed)**

A publicação só acontece com o OK do usuário e fora do serviço (Ramon pediu: nada de atualizar no meio da operação).

```bash
git add desktop/package.json mobile/package.json mobile/android/app/build.gradle
git commit -m "chore: desktop 1.2.88 / Android 1.0.24 (pedido idempotente)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
