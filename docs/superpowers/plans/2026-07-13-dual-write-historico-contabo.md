# Dual-write de vendas para histórico completo no Contabo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Gravar todo pedido fechado (`orders`/`order_items`) também num Postgres próprio no servidor Contabo, além do Supabase, pra ter histórico de vendas permanente, sem tocar em nenhuma leitura existente.

**Architecture:** Banco novo (`ntb_vendas_frio`) no mesmo servidor Contabo já usado pelo `ntb-estoque-next`, endpoint novo (`POST /vendas/orders`) na mesma API HTTP (`ntb-frio-api`, Express + systemd), chamado fire-and-forget de dentro da rota `app/api/integracao/ordem-producao/route.ts` do `ntb-vendas` — único ponto server-side que já roda no fechamento do pedido com o pedido completo em mãos.

**Tech Stack:** Node.js/Express (API no Contabo, já existe), Postgres 17 (já instalado), Next.js/TypeScript (`ntb-vendas`, já existe).

## Global Constraints

- Nenhuma leitura existente do `ntb-vendas` é tocada — só adiciona escrita nova.
- A chamada pro Contabo nunca bloqueia nem quebra o fechamento do pedido nem a integração com o Omie já existente — sempre fire-and-forget com `.catch()`.
- Chave secreta nunca commitada — só em variável de ambiente.
- Não mexer no banco `ntb_frio` (do `ntb-estoque-next`) nem nas rotas dele.
- Sem leitura híbrida nem poda nesta fase (banco do `ntb-vendas` tem 14MB, sem pressão de espaço) — só dual-write e cópia do histórico já existente.
- SSH: `root@185.193.66.240` com a chave em `scratchpad/ssh/contabo_key` (usar `scratchpad/ssh-run.mjs "<comando>"`).

---

### Task 1: Banco `ntb_vendas_frio` no Contabo

**Interfaces:**
- Produces: banco `ntb_vendas_frio`, usuário `ntb_vendas_app`, tabelas `orders`/`order_items`

- [ ] **Step 1: Criar o banco e o usuário**

Via `scratchpad/ssh-run.mjs`:

```bash
sudo -u postgres psql -c "create database ntb_vendas_frio;"
node -e "console.log(require('crypto').randomBytes(24).toString('base64').replace(/[+/=]/g,''))"
```

Anotar a senha gerada — usada no Step 2 e na Task 2.

```bash
sudo -u postgres psql -d ntb_vendas_frio -c "
create user ntb_vendas_app with password '<SENHA_GERADA>';
grant all privileges on database ntb_vendas_frio to ntb_vendas_app;
grant all on schema public to ntb_vendas_app;
"
```

- [ ] **Step 2: Criar as tabelas (schema espelha o Supabase do `ntb-vendas`, IDs são `uuid`)**

```bash
sudo -u postgres psql -d ntb_vendas_frio -c "
create table orders (
  id uuid primary key,
  table_id uuid,
  store_id uuid not null,
  status text not null,
  order_type text not null,
  total numeric(10,2) not null,
  customer_name text,
  payment_method text,
  payment_details jsonb,
  created_at timestamptz not null,
  updated_at timestamptz
);
create table order_items (
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid,
  quantity integer not null,
  status text not null,
  notes text,
  price_at_time numeric(10,2) not null,
  created_at timestamptz not null,
  store_id uuid not null,
  selected_options jsonb not null default '[]'
);
create index idx_vendas_orders_store on orders(store_id);
create index idx_vendas_order_items_order on order_items(order_id);
"
```

- [ ] **Step 3: Confirmar as tabelas criadas**

```bash
sudo -u postgres psql -d ntb_vendas_frio -c "\d orders" -c "\d order_items"
```

---

### Task 2: Endpoint `POST /vendas/orders` na `ntb-frio-api`

**Files:**
- Modify (no servidor Contabo, `/opt/ntb-frio-api/server.js` — fora do repo git): adicionar um segundo `Pool` + rota nova
- Modify (no servidor Contabo, `/opt/ntb-frio-api/.env`): adicionar `VENDAS_DATABASE_URL`/`VENDAS_API_KEY`

**Interfaces:**
- Consumes: banco `ntb_vendas_frio` (Task 1)
- Produces: `POST /vendas/orders`, autenticado por `X-Api-Key`, recebe `{ order: {...}, items: [...] }`, grava numa transação (upsert por `id`)

- [ ] **Step 1: Gerar a chave da API**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- [ ] **Step 2: Adicionar as variáveis ao `.env` existente**

```bash
cat >> /opt/ntb-frio-api/.env << 'EOF'
VENDAS_DATABASE_URL=postgresql://ntb_vendas_app:<SENHA_DA_TASK_1>@localhost:5432/ntb_vendas_frio
VENDAS_API_KEY=<CHAVE_GERADA_NO_STEP_1>
EOF
```

- [ ] **Step 3: Ler o `server.js` atual antes de editar**

```bash
cat /opt/ntb-frio-api/server.js
```

- [ ] **Step 4: Adicionar o `Pool` novo e a rota, logo após a criação do `pool` existente**

Editar uma cópia local do `server.js` (baixado no Step 3), adicionando após a linha `const pool = new Pool({ connectionString: process.env.DATABASE_URL });`:

```javascript
const poolVendas = new Pool({ connectionString: process.env.VENDAS_DATABASE_URL });

function checkAuthVendas(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== process.env.VENDAS_API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}
```

E adicionar a rota, antes de `app.get('/health', ...)`:

```javascript
app.post('/vendas/orders', checkAuthVendas, async (req, res) => {
  const { order, items } = req.body || {};
  if (!order || !Array.isArray(items)) {
    return res.status(400).json({ error: 'order e items sao obrigatorios' });
  }
  const client = await poolVendas.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into orders (id, table_id, store_id, status, order_type, total, customer_name, payment_method, payment_details, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do update set
         status = excluded.status,
         total = excluded.total,
         payment_method = excluded.payment_method,
         payment_details = excluded.payment_details,
         updated_at = excluded.updated_at`,
      [order.id, order.table_id, order.store_id, order.status, order.order_type, order.total,
       order.customer_name, order.payment_method,
       order.payment_details ? JSON.stringify(order.payment_details) : null,
       order.created_at, order.updated_at]
    );
    for (const item of items) {
      await client.query(
        `insert into order_items (id, order_id, product_id, quantity, status, notes, price_at_time, created_at, store_id, selected_options)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (id) do update set status = excluded.status`,
        [item.id, item.order_id, item.product_id, item.quantity, item.status, item.notes,
         item.price_at_time, item.created_at, item.store_id,
         JSON.stringify(item.selected_options ?? [])]
      );
    }
    await client.query('commit');
    res.json({ ok: true });
  } catch (e) {
    await client.query('rollback');
    console.error('Erro ao gravar pedido de vendas no Contabo:', e);
    res.status(500).json({ error: 'internal error' });
  } finally {
    client.release();
  }
});
```

- [ ] **Step 5: Transferir o `server.js` atualizado e reiniciar**

Mesma técnica base64 já usada nas outras tasks:

```bash
node -e "
const fs = require('fs');
const b64 = fs.readFileSync('server.js').toString('base64');
fs.writeFileSync('server.b64', b64);
"
```

```bash
B64=$(cat server.b64)
scratchpad/ssh-run.mjs "echo '$B64' | base64 -d > /opt/ntb-frio-api/server.js && node -c /opt/ntb-frio-api/server.js && echo SYNTAX_OK && systemctl restart ntb-frio-api && sleep 1 && systemctl is-active ntb-frio-api"
```

- [ ] **Step 6: Testar via HTTPS público com um pedido fake**

```bash
curl -s -X POST "https://frio-api.norteparanegocios.com.br/vendas/orders" \
  -H "X-Api-Key: <CHAVE_DA_TASK_2>" -H "Content-Type: application/json" \
  -d '{
    "order": {"id":"00000000-0000-0000-0000-000000000001","table_id":null,"store_id":"00000000-0000-0000-0000-000000000002","status":"delivered","order_type":"counter","total":10.5,"customer_name":"Teste Plano","payment_method":"dinheiro","payment_details":null,"created_at":"2026-07-13T12:00:00Z","updated_at":"2026-07-13T12:00:00Z"},
    "items": [{"id":"00000000-0000-0000-0000-000000000003","order_id":"00000000-0000-0000-0000-000000000001","product_id":null,"quantity":1,"status":"delivered","notes":null,"price_at_time":10.5,"created_at":"2026-07-13T12:00:00Z","store_id":"00000000-0000-0000-0000-000000000002","selected_options":[]}]
  }'
```

Expected: `{"ok":true}`.

- [ ] **Step 7: Confirmar e limpar o registro de teste**

```bash
sudo -u postgres psql -d ntb_vendas_frio -c "select * from orders where id = '00000000-0000-0000-0000-000000000001';"
sudo -u postgres psql -d ntb_vendas_frio -c "delete from orders where id = '00000000-0000-0000-0000-000000000001';"
```

---

### Task 3: Dual-write em `app/api/integracao/ordem-producao/route.ts`

**Files:**
- Modify: `app/api/integracao/ordem-producao/route.ts:77-81` (logo após a busca de `order_items` já existente)
- Modify: `.env.local` (novas vars `NTB_FRIO_API_URL`/`NTB_FRIO_VENDAS_API_KEY`) — e o mesmo par precisa ser configurado nas Environment Variables do projeto na Vercel

**Interfaces:**
- Consumes: `POST https://frio-api.norteparanegocios.com.br/vendas/orders` (Task 2)

- [ ] **Step 1: Adicionar a busca do pedido completo e o dual-write**

Em `app/api/integracao/ordem-producao/route.ts`, logo depois do bloco existente (linhas 77-81):

```ts
  const { data: items } = await admin
    .from('order_items')
    .select('quantity, status, selected_options, product:products(omie_codigo)')
    .in('order_id', orderIds);
```

adicionar:

```ts
  // Dual-write pro Contabo (historico completo de vendas) -- fire-and-forget,
  // nunca bloqueia nem quebra esta rota nem a integracao com o Omie acima.
  if (process.env.NTB_FRIO_API_URL) {
    void (async () => {
      try {
        const [{ data: ordersCompletas }, { data: itemsCompletos }] = await Promise.all([
          admin
            .from('orders')
            .select('id, table_id, store_id, status, order_type, total, customer_name, payment_method, payment_details, created_at, updated_at')
            .in('id', orderIds),
          admin
            .from('order_items')
            .select('id, order_id, product_id, quantity, status, notes, price_at_time, created_at, store_id, selected_options')
            .in('order_id', orderIds),
        ]);
        for (const order of ordersCompletas ?? []) {
          const itensDoPedido = (itemsCompletos ?? []).filter((i) => i.order_id === order.id);
          await fetch(`${process.env.NTB_FRIO_API_URL}/vendas/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.NTB_FRIO_VENDAS_API_KEY! },
            body: JSON.stringify({ order, items: itensDoPedido }),
          });
        }
      } catch (e) {
        console.error('Dual-write de venda pro Contabo falhou:', e);
      }
    })();
  }
```

- [ ] **Step 2: Adicionar as env vars no `.env.local`**

```bash
echo "NTB_FRIO_API_URL=https://frio-api.norteparanegocios.com.br" >> .env.local
echo "NTB_FRIO_VENDAS_API_KEY=<CHAVE_GERADA_NA_TASK_2>" >> .env.local
```

- [ ] **Step 3: Build local**

```bash
npm run build
```

Expected: build passa sem erro.

- [ ] **Step 4: Commit**

```bash
git add app/api/integracao/ordem-producao/route.ts
git commit -m "feat(contabo): dual-write de pedidos fechados para historico completo no Contabo"
```

- [ ] **Step 5: Configurar as env vars na Vercel**

Adicionar `NTB_FRIO_API_URL` e `NTB_FRIO_VENDAS_API_KEY` nas Environment Variables do projeto `ntb-vendas` no dashboard da Vercel (Production + Preview).

---

### Task 4: Cópia do histórico já existente (272 pedidos / 655 itens)

**Files:**
- Create (no servidor Contabo, em `/opt/ntb-backfill-vendas/`, diretório novo — separado do `/opt/ntb-backfill` do `ntb-estoque-next`): `copiar-vendas.mjs`

**Interfaces:**
- Consumes: Supabase do `ntb-vendas` (leitura), banco `ntb_vendas_frio` (escrita)

`orders`/`order_items` usam `id uuid` (não bigint sequencial) — a paginação por
`id > $1 order by id` que o script genérico do `ntb-estoque-next` usa não funciona
aqui (UUID não é ordenável de forma útil). Pagina por `created_at, id` em vez disso.

- [ ] **Step 1: Preparar o diretório e as credenciais**

```bash
mkdir -p /opt/ntb-backfill-vendas && cd /opt/ntb-backfill-vendas && npm init -y && npm install pg dotenv
cat > /opt/ntb-backfill-vendas/.env << 'EOF'
SUPABASE_URL=postgresql://postgres.giiwtnddasminjxweohr:rscarneiro3484*@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
CONTABO_PG_URL=postgresql://ntb_vendas_app:<SENHA_DA_TASK_1>@localhost:5432/ntb_vendas_frio
EOF
chmod 600 /opt/ntb-backfill-vendas/.env
```

(Mesmo pooler regional já usado pelo `ntb-estoque-next`, `aws-1-sa-east-1` —
confirmado em `scripts/.pooler-host` do próprio `ntb-vendas`; `giiwtnddasminjxweohr`
é a referência deste projeto Supabase, diferente do `ntb-estoque-next`.)

- [ ] **Step 2: Criar o script de cópia**

```javascript
// /opt/ntb-backfill-vendas/copiar-vendas.mjs
import 'dotenv/config'
import pg from 'pg'

const supabase = new pg.Client({ connectionString: process.env.SUPABASE_URL, ssl: { rejectUnauthorized: false } })
const contabo = new pg.Client({ connectionString: process.env.CONTABO_PG_URL })
await supabase.connect()
await contabo.connect()

async function copiarTabela(TABLE, colunas) {
  console.log(`\n=== ${TABLE} ===`)
  const totalEsperado = Number((await supabase.query(`select count(*) from "${TABLE}"`)).rows[0].count)
  console.log(`${totalEsperado} linhas a copiar.`)

  const BATCH = 500
  let copiadas = 0
  let ultimoCreatedAt = '1970-01-01T00:00:00Z'
  let ultimoId = '00000000-0000-0000-0000-000000000000'

  for (;;) {
    const dataRes = await supabase.query(
      `select ${colunas.join(', ')} from "${TABLE}"
       where (created_at, id) > ($1, $2)
       order by created_at, id
       limit ${BATCH}`,
      [ultimoCreatedAt, ultimoId]
    )
    if (!dataRes.rows.length) break

    const placeholders = []
    const values = []
    dataRes.rows.forEach((row, i) => {
      placeholders.push(`(${colunas.map((_, j) => `$${i * colunas.length + j + 1}`).join(', ')})`)
      colunas.forEach((c) => {
        const v = row[c]
        values.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v)
      })
    })

    await contabo.query(
      `insert into "${TABLE}" (${colunas.map((c) => `"${c}"`).join(', ')}) values ${placeholders.join(', ')}
       on conflict (id) do nothing`,
      values
    )

    copiadas += dataRes.rows.length
    const last = dataRes.rows[dataRes.rows.length - 1]
    ultimoCreatedAt = last.created_at
    ultimoId = last.id
    process.stdout.write(`\r${copiadas}/${totalEsperado} copiadas...`)
  }

  console.log(`\n${copiadas} linhas copiadas.`)
  const countContabo = Number((await contabo.query(`select count(*) from "${TABLE}"`)).rows[0].count)
  console.log(`Confirmacao: Supabase>=${totalEsperado} Contabo=${countContabo} OK=${countContabo >= totalEsperado}`)
}

await copiarTabela('orders', [
  'id', 'table_id', 'store_id', 'status', 'order_type', 'total',
  'customer_name', 'payment_method', 'payment_details', 'created_at', 'updated_at',
])
await copiarTabela('order_items', [
  'id', 'order_id', 'product_id', 'quantity', 'status', 'notes',
  'price_at_time', 'created_at', 'store_id', 'selected_options',
])

await supabase.end()
await contabo.end()
```

- [ ] **Step 3: Transferir e rodar**

```bash
node -e "
const fs = require('fs');
const b64 = fs.readFileSync('copiar-vendas.mjs').toString('base64');
fs.writeFileSync('copiar-vendas.b64', b64);
"
```

```bash
B64=$(cat copiar-vendas.b64)
scratchpad/ssh-run.mjs "echo '$B64' | base64 -d > /opt/ntb-backfill-vendas/copiar-vendas.mjs && cd /opt/ntb-backfill-vendas && node copiar-vendas.mjs"
```

Expected: `orders` e `order_items` com `OK=true`, contagens batendo com os 272/655 já conhecidos (podem ter crescido um pouco desde a investigação inicial, isso é normal).

---

### Task 5: Validação end-to-end + documentar

**Interfaces:**
- Consumes: Tasks 1-4 completas

- [ ] **Step 1: Confirmar contagens finais**

```bash
node scripts/db.mjs "select count(*) from orders" # Supabase, rodar da raiz do ntb-vendas
```

```bash
scratchpad/ssh-run.mjs "sudo -u postgres psql -d ntb_vendas_frio -c 'select count(*) from orders; select count(*) from order_items;'"
```

- [ ] **Step 2: Teste real — fechar um pedido de teste na Bistrô Demo e confirmar que aparece nos dois lados**

Fechar um pedido de teste na loja Bistrô Demo (nunca em loja real), via UI normal.
Depois:

```bash
node scripts/db.mjs "select id, status, total, updated_at from orders order by updated_at desc limit 3"
```

```bash
scratchpad/ssh-run.mjs "sudo -u postgres psql -d ntb_vendas_frio -c 'select id, status, total, updated_at from orders order by updated_at desc limit 3;'"
```

Expected: o mesmo `id` de pedido aparece nos dois. Apagar o pedido de teste depois (Supabase e Contabo) se não for um pedido real de negócio.

- [ ] **Step 3: Atualizar `AGENTS.md`**

Adicionar uma seção nova descrevendo: o dual-write de `orders`/`order_items` pro
Contabo (banco `ntb_vendas_frio`, mesmo servidor do `ntb-estoque-next`), o motivo
(consistência arquitetural, não pressão de espaço), e que leitura híbrida/poda
ficam para uma fase futura se o volume crescer.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: documenta dual-write de vendas para o Contabo"
git push origin main
```
