# Envio de NFC-e autorizada pra Omie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda NFC-e (modelo 65) autorizada pela SEFAZ no `ntb-vendas` é
registrada automaticamente na Omie da loja, por um de dois caminhos
mutuamente exclusivos: via `ntb-estoque` (loja que já tem essa
integração) ou diretamente do `ntb-vendas` (loja que não usa
`ntb-estoque`).

**Architecture:** Dois repositórios, dois deploys, nenhum código
compartilhado entre eles (convenção já estabelecida no projeto). O
gatilho é único: logo depois que `app/api/fiscal/emitir/route.ts`
(`ntb-vendas`) grava `fiscal_notas` com `status: 'autorizada'`, dispara
via `after()` (fire-and-forget) o Caminho A (POST pro `ntb-estoque`) se
configurado, senão o Caminho B (chamada direta à Omie, dentro do mesmo
processo). Ambos os caminhos chamam o método `IncluirNfce` da Omie
(módulo "Cupom Fiscal") — mesmo payload, código diferente porque cada
repo tem seu próprio client Omie e credenciais próprias.

**Tech Stack:** Next.js 16 (App Router, Route Handlers) nos dois repos,
Supabase self-hosted (Postgres) nos dois, `fetch` nativo (sem SDK de
Omie em nenhum dos dois projetos).

**Spec:** `docs/superpowers/specs/2026-09-05-envio-nota-fiscal-omie-design.md`

## Global Constraints

- **NF-e (modelo 55) fica FORA de escopo deste plano.** Decisão do
  usuário (2026-09-05): o método `ImportarNFe` da Omie tem campos
  (`nCliente`, `cCategoria`, `nContaCorrente`) que sugerem ser pensado
  pra registrar nota de COMPRA (de fornecedor), não de venda —
  confirmar com suporte da Omie antes de implementar esse caminho.
  **Só o caminho NFC-e (modelo 65, `IncluirNfce`) é construído agora.**
  Qualquer nota emitida como modelo 55 simplesmente não dispara nenhum
  envio pra Omie (nem Caminho A nem B) — tratar como "sem ação", nunca
  como erro.
- **`ehChamadaDeEscrita` precisa reconhecer `Importar*` antes de
  qualquer outro código novo** (Task 1) — é o que garante que uma loja
  de teste do `ntb-estoque` nunca escreve de verdade na Omie, e essa
  proteção vale pra QUALQUER chamada de escrita futura no projeto, não
  só esta feature.
- **Nunca sobrescrever `motivo_erro`/`status` de uma `fiscal_notas` já
  `autorizada`** — mesma regra já documentada no topo do arquivo
  `app/api/fiscal/emitir/route.ts`: depois do `cStat=100`, nada pode
  fazer a nota "regredir". Falha no envio pra Omie é sempre só
  `console.error`.
- **Nenhuma policy de SELECT em `store_omie_secrets`** — mesmo padrão
  write-only de `store_fiscal_config_secrets`/`store_ntb_estoque_secrets`.
- Todo teste contra a Omie de verdade (Caminho B, sem simulação de loja
  de teste disponível no `ntb-vendas`) só pode rodar com uma
  credencial de sandbox/teste da própria Omie — nunca com a chave de
  uma loja real de cliente.

---

## Task 1: Corrigir `ehChamadaDeEscrita` pra reconhecer `Importar*` (ntb-estoque)

**Files:**
- Modify: `lib/omie/client.ts:35-37` (repo `ntb-estoque`)

**Interfaces:**
- Consumes: nada novo.
- Produces: `ehChamadaDeEscrita(call: string): boolean` — usado por
  `omieRequest` (mesmo arquivo) e por qualquer chamada de escrita
  futura, incluindo `incluirNfce` (Task 2).

- [ ] **Step 1: Editar o regex**

Em `lib/omie/client.ts`, trocar:

```ts
function ehChamadaDeEscrita(call: string): boolean {
  return /^(Incluir|Alterar|Excluir|Concluir|Reverter)/.test(call)
}
```

por:

```ts
function ehChamadaDeEscrita(call: string): boolean {
  return /^(Incluir|Alterar|Excluir|Concluir|Reverter|Importar)/.test(call)
}
```

- [ ] **Step 2: Verificar manualmente que o comportamento de loja de teste não mudou pras chamadas já existentes**

Rodar localmente (ou via `node -e`) uma checagem rápida de regex, sem
precisar de banco:

```bash
node -e "
const re = /^(Incluir|Alterar|Excluir|Concluir|Reverter|Importar)\b|^(Incluir|Alterar|Excluir|Concluir|Reverter|Importar)/;
const testar = (call) => /^(Incluir|Alterar|Excluir|Concluir|Reverter|Importar)/.test(call);
console.log('IncluirOrdemProducao', testar('IncluirOrdemProducao')); // true (já era)
console.log('ListarProdutos', testar('ListarProdutos')); // false (já era)
console.log('ImportarNFe', testar('ImportarNFe')); // true (NOVO)
console.log('IncluirNfce', testar('IncluirNfce')); // true (já reconhecido, confirma que não regrediu)
"
```

Esperado: as 2 primeiras linhas mantêm o valor de antes da mudança
(`true`/`false`), as 2 últimas são `true`.

- [ ] **Step 3: Commit**

```bash
cd "ntb estoque"
git add lib/omie/client.ts
git commit -m "fix: ehChamadaDeEscrita reconhece chamadas Importar* como escrita

Loja de teste (is_test=true) nunca deveria escrever de verdade na Omie,
mas o regex só cobria Incluir/Alterar/Excluir/Concluir/Reverter —
ImportarNFe/ImportarNFCe/ImportarCTe/ImportarCfeSat (todos métodos de
escrita reais da Omie) passavam direto sem simulação. Achado durante o
design do envio de NFC-e pra Omie (ver docs/superpowers/specs/
2026-09-05-envio-nota-fiscal-omie-design.md no ntb-vendas)."
```

---

## Task 2: Client Omie mínimo + `incluirNfce` (ntb-estoque)

**Files:**
- Create: `lib/omie/nota-fiscal-venda.ts` (repo `ntb-estoque`) — nome
  novo pra não colidir com `lib/omie/nota-fiscal.ts`, que já existe e é
  sobre RECEBIMENTO de nota de compra (`gravarNotaFiscalNoFrio`/
  `syncNotasFiscais`), assunto diferente.

**Interfaces:**
- Consumes: `omieRequest`, `LojaOmie`, `logIntegrationAttempt` (`lib/omie/client.ts`, já existentes).
- Produces: `incluirNfce(loja: LojaOmie, payload: IncluirNfcePayload): Promise<{ status: string }>`
  e o tipo `IncluirNfcePayload` — consumidos pela Task 3.

- [ ] **Step 1: Criar o arquivo com o tipo do payload e a função**

```ts
// lib/omie/nota-fiscal-venda.ts
import { omieRequest, type LojaOmie } from './client'

// Payload do método IncluirNfce (serviço produtos/cupomfiscalincluir/),
// campos confirmados na documentação oficial da Omie (fetch feito em
// 2026-09-05, ver docs/superpowers/specs/2026-09-05-envio-nota-fiscal-
// omie-design.md no ntb-vendas). NÃO existe campo de observação/texto
// livre neste payload — a Omie não recebe nenhum rótulo de "quem
// enviou"; isso fica só em integration_attempts (ver Task 3).
export interface IncluirNfceItem {
  cProd: string
  xProd: string
  ncm: string
  cfop: string
  qCom: number
  vUnCom: number
}

export interface IncluirNfcePagamento {
  // Código SEFAZ de forma de pagamento (Nota Técnica 2015/002), mesmo
  // valor já usado no <detPag>/<tPag> do XML da própria nota — não
  // recalcular aqui, receber pronto de quem monta o payload.
  tPag: string
  vPag: number
}

export interface IncluirNfcePayload {
  chNFe: string // chave de acesso, 44 dígitos
  nNF: number
  serie: number
  dEmi: string // AAAA-MM-DD
  hEmi: string // HH:mm:ss
  tpAmb: 1 | 2 // 1 = produção, 2 = homologação
  itens: IncluirNfceItem[]
  pagamentos: IncluirNfcePagamento[]
  nfceXml: string // XML completo já assinado + protNFe (nfeProc)
  nfceMd5: string // MD5 hex do nfceXml
  nfceProt: string // número do protocolo de autorização
  vNF: number // valor total da nota
}

function montarDetItem(item: IncluirNfceItem, seqItem: number) {
  const vProd = Number((item.qCom * item.vUnCom).toFixed(2))
  return {
    seqItem,
    lCanc: 'N',
    lNaoMovEstoque: 'N',
    prodIdent: { cProd: item.cProd },
    prod: {
      cProd: item.cProd,
      xProd: item.xProd,
      NCM: item.ncm,
      CFOP: item.cfop,
      cUn: 'UN',
      nQuant: item.qCom,
      vUnit: item.vUnCom,
      vProd,
      vDesc: 0,
      vAcresc: 0,
    },
  }
}

export async function incluirNfce(loja: LojaOmie, payload: IncluirNfcePayload) {
  const vProdTotal = payload.itens.reduce((acc, i) => acc + Number((i.qCom * i.vUnCom).toFixed(2)), 0)

  return omieRequest<{ status: string }>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/cupomfiscalincluir',
    call: 'IncluirNfce',
    data: {
      NFe: {
        chNFe: payload.chNFe,
        nNF: payload.nNF,
        serie: payload.serie,
        dEmi: payload.dEmi,
        hEmi: payload.hEmi,
        tpAmb: payload.tpAmb,
        tpEmis: 1,
        lCanc: 'N',
        det: payload.itens.map((item, idx) => montarDetItem(item, idx + 1)),
        total: {
          vItem: vProdTotal,
          vProd: vProdTotal,
          vDesc: 0,
          vAcresc: 0,
          vICMS: 0,
          vCF: 0,
          vTaxa: 0,
          vTotTrib: 0,
        },
      },
      formasPag: payload.pagamentos.map((p, idx) => ({
        seqPag: idx + 1,
        pagIdent: { pag: p.tPag },
        pag: { tPag: p.tPag, vPag: p.vPag },
        lCanc: 'N',
        lNaoGerarTitulo: 'S',
      })),
      nfce: {
        nfceXml: payload.nfceXml,
        nfceMd5: payload.nfceMd5,
        nfceProt: payload.nfceProt,
      },
    },
  })
}
```

- [ ] **Step 2: Confirmar que compila**

```bash
cd "ntb estoque"
npx tsc --noEmit
```

Esperado: sem erro relacionado a `lib/omie/nota-fiscal-venda.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/omie/nota-fiscal-venda.ts
git commit -m "feat: incluirNfce — registra NFC-e autorizada no módulo Cupom Fiscal da Omie"
```

---

## Task 3: Endpoint `/api/integracao/nota-fiscal` (ntb-estoque)

**Files:**
- Create: `app/api/integracao/nota-fiscal/route.ts` (repo `ntb-estoque`)

**Interfaces:**
- Consumes: `incluirNfce`, `IncluirNfcePayload` (Task 2);
  `logIntegrationAttempt`, `LojaOmie` (`lib/omie/client.ts`).
- Produces: endpoint HTTP `POST /api/integracao/nota-fiscal`, consumido
  pela Task 8 (`ntb-vendas`). Corpo esperado (JSON):
  `{ chNFe, nNF, serie, dEmi, hEmi, tpAmb, itens, pagamentos, nfceXml, nfceMd5, nfceProt, vNF }`
  (mesmo shape de `IncluirNfcePayload`, ver Task 2).

- [ ] **Step 1: Criar a rota**

Mesmo padrão de autenticação de `app/api/integracao/ordem-producao/route.ts`
(Bearer contra `lojas.integracao_api_key`):

```ts
// app/api/integracao/nota-fiscal/route.ts
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { incluirNfce, type IncluirNfcePayload } from '@/lib/omie/nota-fiscal-venda'
import { logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'

// Rota externa (não-sessão) pro ntb-vendas disparar o registro de uma
// NFC-e já autorizada pela SEFAZ na Omie da loja. Mesma autenticação de
// app/api/integracao/ordem-producao/route.ts (API key por loja).
// ATENÇÃO: escreve de verdade no Omie da loja (exceto is_test=true, ver
// ehChamadaDeEscrita em lib/omie/client.ts).

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as IncluirNfcePayload | null
  if (!body?.chNFe || !body.itens?.length) {
    return NextResponse.json({ error: 'Payload inválido: chNFe e itens são obrigatórios' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('integracao_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<LojaOmie>()

  if (!loja) {
    return NextResponse.json({ error: 'Chave de integração inválida' }, { status: 401 })
  }

  if (!loja.omie_app_key || !loja.omie_app_secret) {
    return NextResponse.json({ skipped: true, reason: 'Loja sem Omie configurada' })
  }

  try {
    const resultado = await incluirNfce(loja, body)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'IncluirNfce [Norte Para Negócios]',
      request: `chNFe=${body.chNFe} vNF=${body.vNF}`,
      response: JSON.stringify(resultado),
      code: '0',
    })
    return NextResponse.json({ ok: true, resultado })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha desconhecida na chamada Omie'
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'IncluirNfce [Norte Para Negócios]',
      request: `chNFe=${body.chNFe} vNF=${body.vNF}`,
      error: true,
      error_message: msg,
    })
    return NextResponse.json({ ok: false, reason: msg })
  }
}
```

- [ ] **Step 2: Confirmar que compila**

```bash
cd "ntb estoque"
npx tsc --noEmit
```

- [ ] **Step 3: Deploy e teste manual com uma loja de teste (`is_test=true`)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```

Depois, com a `integracao_api_key` de uma loja de teste real (ex.: `[TESTE] O SERTAO VAI VIRAR MAR`, já usada em outras integrações desta sessão):

```bash
curl -s -X POST https://app-estoque.norteparanegocios.com.br/api/integracao/nota-fiscal \
  -H "Authorization: Bearer <integracao_api_key da loja de teste>" \
  -H "Content-Type: application/json" \
  -d '{
    "chNFe": "29260800000000000000650010000000011000000000",
    "nNF": 1, "serie": 1,
    "dEmi": "2026-09-05", "hEmi": "12:00:00",
    "tpAmb": 2,
    "itens": [{"cProd": "1", "xProd": "Produto Teste", "ncm": "21069090", "cfop": "5102", "qCom": 1, "vUnCom": 10}],
    "pagamentos": [{"tPag": "01", "vPag": 10}],
    "nfceXml": "<nfeProc>...</nfeProc>", "nfceMd5": "d41d8cd98f00b204e9800998ecf8427e",
    "nfceProt": "123456789012345", "vNF": 10
  }'
```

Esperado: `{"ok":true,"resultado":{...}}` com a resposta simulada (loja
de teste), e uma linha nova em `integration_attempts` com
`model = 'IncluirNfce [Norte Para Negócios]'` — confirmar via:

```bash
docker exec supabase-db psql -U supabase_admin -d postgres -c \
  "select loja_id, model, code, error from integration_attempts order by id desc limit 1;"
```

- [ ] **Step 4: Commit**

```bash
git add app/api/integracao/nota-fiscal/route.ts
git commit -m "feat: rota /api/integracao/nota-fiscal — registra NFC-e do ntb-vendas na Omie"
```

---

## Task 4: Tabela `store_omie_secrets` + RPC de status (ntb-vendas)

**Files:**
- Create: `supabase/migrations/071_store_omie_secrets.sql`

**Interfaces:**
- Produces: tabela `store_omie_secrets(store_id, omie_app_key, omie_app_secret, updated_at)`;
  RPC `fetch_omie_direto_status_secure(p_store_id uuid) returns jsonb`
  → `{ configurado: boolean }`, consumida pela Task 6.

- [ ] **Step 1: Escrever a migration**

```sql
-- 071_store_omie_secrets.sql
--
-- Chave direta da Omie pra lojas que usam SÓ o ntb-vendas (sem
-- ntb-estoque) — permite registrar a NFC-e autorizada direto na Omie
-- da loja, sem passar por integração nenhuma. Write-only de verdade,
-- mesmo princípio de store_fiscal_config_secrets (migration 024) e
-- store_ntb_estoque_secrets (migration 027): zero policy de select.
-- Ver docs/superpowers/specs/2026-09-05-envio-nota-fiscal-omie-design.md.

create table if not exists store_omie_secrets (
  store_id uuid primary key references stores(id) on delete cascade,
  omie_app_key text not null,
  omie_app_secret text not null,
  updated_at timestamptz not null default now()
);

alter table store_omie_secrets enable row level security;

-- Sem policy nenhuma pra anon/authenticated: nem select, nem insert,
-- nem update — só a service role (app/api/integracao/omie-direto/
-- route.ts) escreve. Mesmo padrão de store_ntb_estoque_secrets.

-- Function security definer só pra UI saber "configurado ou não", sem
-- nunca ler a chave de volta.
create or replace function public.fetch_omie_direto_status_secure(p_store_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existe boolean;
begin
  select exists(select 1 from store_omie_secrets where store_id = p_store_id) into v_existe;
  return jsonb_build_object('configurado', v_existe);
end;
$$;

grant execute on function public.fetch_omie_direto_status_secure(uuid) to anon, authenticated;
```

- [ ] **Step 2: Aplicar a migration em produção**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
node scripts/aplicar-migration.mjs 071_store_omie_secrets.sql
```

- [ ] **Step 3: Verificar direto no banco**

```bash
node scripts/db.mjs "select proname from pg_proc where proname = 'fetch_omie_direto_status_secure'"
node scripts/db.mjs "select column_name from information_schema.columns where table_name = 'store_omie_secrets' order by ordinal_position"
```

Esperado: 1 linha na primeira query; `store_id, omie_app_key,
omie_app_secret, updated_at` na segunda.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/071_store_omie_secrets.sql
git commit -m "feat: store_omie_secrets — chave Omie direta pra loja só-ntb-vendas"
```

---

## Task 5: Rota `/api/integracao/omie-direto` (salvar a chave) (ntb-vendas)

**Files:**
- Create: `app/api/integracao/omie-direto/route.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` (`lib/supabaseAdmin.ts`, já existente).
- Produces: `POST /api/integracao/omie-direto` — corpo `{ storeId, omieAppKey, omieAppSecret }`,
  resposta `{ success: boolean, message?: string }`. Consumida pela
  Task 6 (`lib/api.ts`).

- [ ] **Step 1: Criar a rota, mesmo padrão de `app/api/integracao/configurar/route.ts`**

```ts
// app/api/integracao/omie-direto/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Configura a chave direta da Omie (ver store_omie_secrets, migration
// 071) pra lojas que NÃO usam ntb-estoque. Write-only de verdade —
// só a service role, aqui, consegue gravar; a UI nunca lê de volta.

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestBody {
  storeId?: string;
  omieAppKey?: string;
  omieAppSecret?: string;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body?.storeId || !UUID_RE.test(body.storeId)) {
    return NextResponse.json({ success: false, message: 'storeId inválido.' }, { status: 400 });
  }
  if (!body.omieAppKey || !body.omieAppSecret) {
    return NextResponse.json({ success: false, message: 'App Key e App Secret da Omie são obrigatórios.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('store_omie_secrets').upsert(
    {
      store_id: body.storeId,
      omie_app_key: body.omieAppKey,
      omie_app_secret: body.omieAppSecret,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'store_id' }
  );
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Confirmar que compila**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/api/integracao/omie-direto/route.ts
git commit -m "feat: rota /api/integracao/omie-direto — salva chave Omie direta write-only"
```

---

## Task 6: `lib/api.ts` — status + save da chave Omie direta (ntb-vendas)

**Files:**
- Modify: `lib/api.ts` (adicionar perto de `fetchNtbEstoqueIntegracaoStatus`/`saveNtbEstoqueIntegracaoConfig`)

**Interfaces:**
- Consumes: `supabase` (client já importado no arquivo), rota da Task 5.
- Produces: `fetchOmieDiretoStatus(storeId): Promise<{ configurado: boolean }>`,
  `saveOmieDiretoConfig(storeId, { omieAppKey, omieAppSecret }): Promise<{ success: boolean; message?: string }>` —
  consumidos pela Task 9 (UI).

- [ ] **Step 1: Adicionar as duas funções**

```ts
// Chave direta da Omie (store_omie_secrets, migration 071) — pra lojas
// que NÃO usam ntb-estoque, registra a NFC-e autorizada direto na Omie
// (ver app/api/fiscal/emitir/route.ts). Mesmo princípio write-only já
// usado em fetchNtbEstoqueIntegracaoStatus/saveNtbEstoqueIntegracaoConfig
// logo acima: status via RPC (nunca expõe a chave), escrita via rota
// própria (service role).
export interface OmieDiretoStatus {
  configurado: boolean;
}

export const fetchOmieDiretoStatus = async (storeId: string): Promise<OmieDiretoStatus> => {
  const { data, error } = await supabase.rpc('fetch_omie_direto_status_secure', { p_store_id: storeId });
  if (error || !data) return { configurado: false };
  return data as OmieDiretoStatus;
};

export const saveOmieDiretoConfig = async (
  storeId: string,
  params: { omieAppKey: string; omieAppSecret: string }
): Promise<{ success: boolean; message?: string }> => {
  try {
    const res = await fetch('/api/integracao/omie-direto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, ...params }),
    });
    return await res.json();
  } catch (error: any) {
    return { success: false, message: error.message };
  }
};
```

- [ ] **Step 2: Confirmar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/api.ts
git commit -m "feat: fetchOmieDiretoStatus/saveOmieDiretoConfig em lib/api.ts"
```

---

## Task 7: Client Omie + payload builder (ntb-vendas)

**Files:**
- Create: `lib/omie/client.ts` (novo neste repo — `ntb-vendas` nunca chamou a Omie antes)
- Create: `lib/omie/nota-fiscal.ts`

**Interfaces:**
- Produces: `incluirNfceDireto(credenciais: { appKey: string; appSecret: string }, payload: IncluirNfcePayload): Promise<{ status: string }>`
  e `montarPayloadIncluirNfce(args): IncluirNfcePayload` — consumidos
  pela Task 8. `IncluirNfcePayload` é o MESMO shape definido na Task 2
  (repositório diferente, mesma estrutura — não há import cross-repo).

- [ ] **Step 1: Criar `lib/omie/client.ts` (client mínimo, sem conceito de loja de teste — ver Global Constraints)**

```ts
// lib/omie/client.ts
// Client Omie mínimo deste projeto — SEM o conceito de "loja de teste"
// que o ntb-estoque tem (ver AGENTS.md, seção "Lojas de Teste"): este
// caminho só é chamado depois de cStat=100 (nota real, autorizada pela
// SEFAZ), então "escrever de verdade" é sempre o comportamento
// desejado aqui. Testar este client precisa de credencial de
// sandbox/teste da própria Omie — nunca da chave de uma loja real.

const OMIE_BASE_URL = 'https://app.omie.com.br/api/';

export class OmieError extends Error {
  constructor(message: string, public readonly faultCode?: string) {
    super(message);
    this.name = 'OmieError';
  }
}

export async function omieRequest<T = unknown>(
  endpoint: string,
  call: string,
  data: Record<string, unknown>,
  credenciais: { appKey: string; appSecret: string }
): Promise<T> {
  const res = await fetch(`${OMIE_BASE_URL}${endpoint}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_key: credenciais.appKey, app_secret: credenciais.appSecret, call, param: [data] }),
  });

  const json = (await res.json().catch(() => null)) as (T & { faultstring?: string; faultcode?: string }) | null;
  if (!res.ok || (json && 'faultstring' in json && json.faultstring)) {
    throw new OmieError(json?.faultstring || `Omie HTTP ${res.status}`, json?.faultcode);
  }
  return json as T;
}
```

- [ ] **Step 2: Criar `lib/omie/nota-fiscal.ts` (payload + chamada)**

Mesmo shape de payload da Task 2 (`ntb-estoque`), sem import
cross-repo — cada projeto tem sua própria cópia, por design (ver
Global Constraints do spec: "sem código compartilhado entre eles").

```ts
// lib/omie/nota-fiscal.ts
import { omieRequest } from './client';
import type { ItemNota, PagamentoNota } from '@/lib/fiscal/xml';

export interface IncluirNfcePayload {
  chNFe: string;
  nNF: number;
  serie: number;
  dEmi: string;
  hEmi: string;
  tpAmb: 1 | 2;
  itens: { cProd: string; xProd: string; ncm: string; cfop: string; qCom: number; vUnCom: number }[];
  pagamentos: { tPag: string; vPag: number }[];
  nfceXml: string;
  nfceMd5: string;
  nfceProt: string;
  vNF: number;
}

// Mesma tabela de código de forma de pagamento já usada no XML da
// própria nota (lib/fiscal/xml.ts, mapMetodoParaTPag) — reaproveitada
// aqui só pra não duplicar o switch, sem importar a função privada.
function tPagDoMetodo(method: string): string {
  switch (method) {
    case 'CREDIT': return '03';
    case 'DEBIT': return '04';
    case 'PIX': return '17';
    case 'COURTESY': return '90';
    case 'CASH':
    default: return '01';
  }
}

// Monta o payload a partir dos MESMOS dados já usados pra montar o XML
// da nota (ItemNota[]/PagamentoNota[], lib/fiscal/xml.ts) — nunca
// recalcula preço/imposto, só reformata pro shape que a Omie espera.
export function montarPayloadIncluirNfce(args: {
  chave: string;
  numero: number;
  serie: number;
  dataEmissao: Date;
  ambiente: 'homologacao' | 'producao';
  itens: ItemNota[];
  pagamentos: PagamentoNota[];
  nfeProcXml: string;
  nfceMd5: string;
  protocolo: string;
  valorTotal: number;
}): IncluirNfcePayload {
  const dEmi = args.dataEmissao.toISOString().slice(0, 10);
  const hEmi = args.dataEmissao.toISOString().slice(11, 19);

  return {
    chNFe: args.chave,
    nNF: args.numero,
    serie: args.serie,
    dEmi,
    hEmi,
    tpAmb: args.ambiente === 'homologacao' ? 2 : 1,
    itens: args.itens.map((i) => ({
      cProd: i.cProd,
      xProd: i.xProd,
      ncm: i.ncm,
      cfop: i.cfop ?? '5102',
      qCom: i.qCom,
      vUnCom: i.vUnCom,
    })),
    pagamentos: args.pagamentos.map((p) => ({ tPag: tPagDoMetodo(p.method), vPag: p.amount })),
    nfceXml: args.nfeProcXml,
    nfceMd5: args.nfceMd5,
    nfceProt: args.protocolo,
    vNF: args.valorTotal,
  };
}

export async function incluirNfceDireto(
  credenciais: { appKey: string; appSecret: string },
  payload: IncluirNfcePayload
): Promise<{ status: string }> {
  const vProdTotal = payload.itens.reduce((acc, i) => acc + Number((i.qCom * i.vUnCom).toFixed(2)), 0);

  return omieRequest<{ status: string }>(
    'v1/produtos/cupomfiscalincluir',
    'IncluirNfce',
    {
      NFe: {
        chNFe: payload.chNFe,
        nNF: payload.nNF,
        serie: payload.serie,
        dEmi: payload.dEmi,
        hEmi: payload.hEmi,
        tpAmb: payload.tpAmb,
        tpEmis: 1,
        lCanc: 'N',
        det: payload.itens.map((item, idx) => ({
          seqItem: idx + 1,
          lCanc: 'N',
          lNaoMovEstoque: 'N',
          prodIdent: { cProd: item.cProd },
          prod: {
            cProd: item.cProd,
            xProd: item.xProd,
            NCM: item.ncm,
            CFOP: item.cfop,
            cUn: 'UN',
            nQuant: item.qCom,
            vUnit: item.vUnCom,
            vProd: Number((item.qCom * item.vUnCom).toFixed(2)),
            vDesc: 0,
            vAcresc: 0,
          },
        })),
        total: { vItem: vProdTotal, vProd: vProdTotal, vDesc: 0, vAcresc: 0, vICMS: 0, vCF: 0, vTaxa: 0, vTotTrib: 0 },
      },
      formasPag: payload.pagamentos.map((p, idx) => ({
        seqPag: idx + 1,
        pagIdent: { pag: p.tPag },
        pag: { tPag: p.tPag, vPag: p.vPag },
        lCanc: 'N',
        lNaoGerarTitulo: 'S',
      })),
      nfce: { nfceXml: payload.nfceXml, nfceMd5: payload.nfceMd5, nfceProt: payload.nfceProt },
    },
    credenciais
  );
}
```

- [ ] **Step 3: Confirmar que `ItemNota`/`PagamentoNota` são exportados de `lib/fiscal/xml.ts`**

```bash
grep -n "^export interface ItemNota\|^export interface PagamentoNota" lib/fiscal/xml.ts
```

Esperado: as duas linhas aparecem (já são exportadas hoje, ver
`lib/fiscal/xml.ts:3` e `:43` — nenhuma mudança necessária nesse
arquivo).

- [ ] **Step 4: Confirmar que compila**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add lib/omie/client.ts lib/omie/nota-fiscal.ts
git commit -m "feat: client Omie mínimo + incluirNfceDireto pro Caminho B (loja só ntb-vendas)"
```

---

## Task 8: Disparo dos dois caminhos em `app/api/fiscal/emitir/route.ts` (ntb-vendas)

**Files:**
- Modify: `app/api/fiscal/emitir/route.ts` (logo depois do bloco de
  insert com `status: 'autorizada'`, atualmente terminando por volta da
  linha 707 — ver "Files and Code Sections" do histórico da sessão;
  confirmar o número exato de linha antes de editar, pode ter mudado)

**Interfaces:**
- Consumes: `montarPayloadIncluirNfce`, `incluirNfceDireto` (Task 7);
  rota `/api/integracao/nota-fiscal` (Task 3, via `fetch` HTTP);
  `getSupabaseAdmin` (já importado no arquivo).
- Produces: nenhuma interface nova pra fora — é o ponto final da cadeia.

- [ ] **Step 1: Localizar o ponto de inserção**

```bash
grep -n "notaInserida.id\|return NextResponse.json({\s*$" app/api/fiscal/emitir/route.ts | tail -10
```

O ponto certo é logo DEPOIS do bloco `if (insertErr) { ... } else { ...
order_items ... }` (que marca os itens como faturados) e ANTES do
`return NextResponse.json({ ok: true, chave, protocolo, ... })` final
da rota.

- [ ] **Step 2: Só disparar pra modelo 65 (ver Global Constraints — modelo 55 fora de escopo)**

Adicionar, logo antes do `return NextResponse.json({ ok: true, ...`
final:

```ts
  // Envio pra Omie (2026-09-05) — só NFC-e (modelo 65) por enquanto,
  // ver Global Constraints do plano/spec pro porquê do modelo 55 ficar
  // de fora. Fire-and-forget: falha aqui nunca muda o status da nota
  // já autorizada, só loga (mesmo princípio do resto desta rota a
  // partir do cStat=100).
  if (modelo === '65') {
    after(async () => {
      try {
        // itensXml (ItemNota[]) e paymentDetailsAncora já foram montados
        // mais acima nesta mesma rota, pra construir o XML da própria nota
        // (ver "6. Monta itens do XML" e a chamada a montarXmlNota) —
        // reaproveitados aqui tal qual, nunca recalculados.
        const nfeProcXml = montarNfeProc(xmlAssinado, resposta.xmlBruto.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? '');
        const payload = montarPayloadIncluirNfce({
          chave,
          numero,
          serie,
          dataEmissao: new Date(),
          ambiente: config.ambiente,
          itens: itensXml,
          pagamentos: Array.isArray((paymentDetailsAncora as any)?.methods)
            ? ((paymentDetailsAncora as any).methods as PagamentoNota[])
            : [{ method: 'CASH', amount: valorTotalComTaxa }],
          nfeProcXml,
          nfceMd5: createHash('md5').update(nfeProcXml).digest('hex'),
          protocolo: resposta.protocolo,
          valorTotal: valorTotalComTaxa,
        });

        // Caminho A: loja com ntb-estoque configurado e ativo.
        const { data: ntbEstoqueSecret } = await admin
          .from('store_ntb_estoque_secrets')
          .select('ntb_estoque_url, ntb_estoque_api_key, ativo')
          .eq('store_id', storeId)
          .maybeSingle();

        if (ntbEstoqueSecret?.ativo) {
          await fetch(`${ntbEstoqueSecret.ntb_estoque_url.replace(/\/$/, '')}/api/integracao/nota-fiscal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ntbEstoqueSecret.ntb_estoque_api_key}` },
            body: JSON.stringify(payload),
          });
          return;
        }

        // Caminho B: loja só com ntb-vendas, chave Omie direta.
        const { data: omieSecret } = await admin
          .from('store_omie_secrets')
          .select('omie_app_key, omie_app_secret')
          .eq('store_id', storeId)
          .maybeSingle();

        if (omieSecret) {
          await incluirNfceDireto({ appKey: omieSecret.omie_app_key, appSecret: omieSecret.omie_app_secret }, payload);
        }
        // Nem A nem B configurado: no-op silencioso, loja não quer Omie.
      } catch (e) {
        console.error('Envio de NFC-e pra Omie falhou (nota já autorizada, sem impacto no status):', e);
      }
    });
  }

```

- [ ] **Step 3: Ajustar os imports no topo do arquivo**

Hoje a linha 1 é `import { NextRequest, NextResponse } from 'next/server';`
— **não** importa `after` ainda (confirmado nesta sessão). Trocar por:

```ts
import { NextRequest, NextResponse, after } from 'next/server';
```

E adicionar, junto dos outros imports (`ItemNota`/`PagamentoNota` de
`@/lib/fiscal/xml` e `montarNfeProc` de `@/lib/fiscal/pdf` já existem,
não duplicar):

```ts
import { createHash } from 'crypto';
import { montarPayloadIncluirNfce, incluirNfceDireto } from '@/lib/omie/nota-fiscal';
```

- [ ] **Step 4: Confirmar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add app/api/fiscal/emitir/route.ts
git commit -m "feat: dispara envio de NFC-e autorizada pra Omie (Caminho A ntb-estoque / Caminho B direto)"
```

---

## Task 9: UI — "Integração direta com a Omie" (ntb-vendas)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (dentro de
  `StoreAdminView`, dentro de `activeTab === 'fiscal'`, logo depois do
  `Collapsible title="Certificado Digital"` que fecha por volta da
  linha 7950 — ver leitura feita nesta sessão)

**Interfaces:**
- Consumes: `fetchOmieDiretoStatus`, `saveOmieDiretoConfig` (Task 6).

- [ ] **Step 1: Adicionar o state, perto dos outros states de
      `StoreAdminView` (junto de `certFile`/`certPassword` etc.)**

```ts
const [omieDiretoConfigurado, setOmieDiretoConfigurado] = useState(false);
const [omieAppKeyInput, setOmieAppKeyInput] = useState('');
const [omieAppSecretInput, setOmieAppSecretInput] = useState('');
const [isSavingOmieDireto, setIsSavingOmieDireto] = useState(false);
```

- [ ] **Step 2: Carregar o status junto de `loadFiscalData`**

Dentro de `loadFiscalData` (mesma função que já chama
`fetchStoreCertificateStatus`/`fetchStoreFiscalConfig`), adicionar:

```ts
const omieStatus = await fetchOmieDiretoStatus(storeId);
setOmieDiretoConfigurado(omieStatus.configurado);
```

- [ ] **Step 3: Handler de salvar**

Junto dos outros handlers (`handleSaveCertificate`/`handleSaveFiscalConfig`):

```ts
const handleSaveOmieDireto = async () => {
    if (!omieAppKeyInput || !omieAppSecretInput) {
        return toast.error('Preencha App Key e App Secret da Omie.');
    }
    setIsSavingOmieDireto(true);
    try {
        const result = await saveOmieDiretoConfig(storeId, { omieAppKey: omieAppKeyInput, omieAppSecret: omieAppSecretInput });
        if (!result.success) throw new Error(result.message);
        toast.success('Integração direta com a Omie salva!');
        setOmieAppKeyInput('');
        setOmieAppSecretInput('');
        setOmieDiretoConfigurado(true);
    } catch (e: any) {
        toast.error('Erro ao salvar integração Omie: ' + e.message);
    } finally {
        setIsSavingOmieDireto(false);
    }
};
```

- [ ] **Step 4: JSX — novo `Collapsible`, logo depois do de "Certificado Digital" (linha ~7950)**

```tsx
{/* Integração direta com a Omie (2026-09-05) — só pra loja que NÃO usa
    ntb-estoque; se a loja tiver ntb-estoque configurado E ativo, esse
    caminho nunca é usado (ver app/api/fiscal/emitir/route.ts). */}
<Collapsible
    title="Integração direta com a Omie"
    defaultOpen={false}
    badge={omieDiretoConfigurado ? <Badge color="bg-[var(--ok)]/10 border border-[var(--ok)]/30 text-[var(--ok)]">Configurado</Badge> : undefined}
>
    <div className="space-y-3">
        <p className="text-sm text-[var(--text-muted)]">
            Pra lojas que não usam o NTB Estoque: registra a NFC-e autorizada direto na Omie, sem passar por outra integração.
            Se a loja tiver integração com o NTB Estoque ativa, ela sempre tem prioridade sobre esta.
        </p>
        <div className="grid grid-cols-2 gap-4">
            <Input
                label="App Key da Omie"
                placeholder={omieDiretoConfigurado ? '••••••••  (preencher só pra trocar)' : 'App Key da conta Omie da loja'}
                value={omieAppKeyInput}
                onChange={e => setOmieAppKeyInput(e.target.value)}
            />
            <Input
                label="App Secret da Omie"
                type="password"
                placeholder={omieDiretoConfigurado ? '••••••••  (preencher só pra trocar)' : 'App Secret da conta Omie da loja'}
                value={omieAppSecretInput}
                onChange={e => setOmieAppSecretInput(e.target.value)}
            />
        </div>
        <p className="text-xs text-[var(--text-muted)]">A chave nunca é exibida de volta depois de salva — deixe em branco se não quiser trocá-la.</p>
        <Button variant="secondary" className="w-full" onClick={handleSaveOmieDireto} isLoading={isSavingOmieDireto}>
            Salvar Integração Direta com a Omie
        </Button>
    </div>
</Collapsible>
```

- [ ] **Step 5: Confirmar que compila e builda**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: Testar ao vivo (ZZ Laboratorio, dev local ou Chrome DevTools MCP)**

1. Login na ZZ Laboratorio → Administração → Notas Fiscais.
2. Abrir "Integração direta com a Omie", preencher App Key/Secret com
   valores de teste (não precisa ser uma conta Omie real pra este
   teste de UI — só confirmar que salva e o badge "Configurado"
   aparece).
3. Recarregar a página, confirmar que os campos voltam vazios mas o
   badge "Configurado" continua aparecendo (confirma o comportamento
   write-only).
4. Apagar o dado de teste do banco ao final:
   `node scripts/db.mjs "delete from store_omie_secrets where store_id = '<id da ZZ Laboratorio>'"`

- [ ] **Step 7: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat: UI de integração direta com a Omie em Administração > Notas Fiscais"
```

---

## Task 10: Deploy e verificação ponta a ponta

**Files:** nenhum (só deploy + QA)

- [ ] **Step 1: Deploy do `ntb-estoque` primeiro (Tasks 1-3) — precisa estar no ar antes do `ntb-vendas` chamar a rota nova**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```

- [ ] **Step 2: Deploy do `ntb-vendas` (Tasks 4-9)**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-vendas && nohup bash deploy.sh > /tmp/deploy-omie.log 2>&1 & disown; echo STARTED"
```

Monitorar até `bash deploy.sh` terminar (mesmo procedimento já usado
nesta sessão pro deploy do redesign do cardápio), depois confirmar:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://testvendase.norteparanegocios.com.br/loja
```

- [ ] **Step 3: Teste Caminho A ponta a ponta, em HOMOLOGAÇÃO, loja de teste dos dois lados**

Usar uma loja de teste do `ntb-vendas` (ZZ Laboratorio) com
`store_fiscal_config.ambiente = 'homologacao'` e certificado válido já
configurado (ver sessões anteriores), ligada via `store_ntb_estoque_secrets`
a uma loja de teste `is_test=true` do `ntb-estoque`. Fechar uma venda
de teste que dispare `modelo_emissao_automatica = 'nfce'`, confirmar:

1. `fiscal_notas` da ZZ Laboratorio tem a nota com `status = 'autorizada'`.
2. `integration_attempts` do `ntb-estoque` tem uma linha nova
   `model = 'IncluirNfce [Norte Para Negócios]'`, `error = false`.

```bash
docker exec supabase-db psql -U supabase_admin -d postgres -c \
  "select loja_id, model, code, error, created_at from integration_attempts where model like 'IncluirNfce%' order by id desc limit 3;"
```

- [ ] **Step 4: Teste Caminho B — só validação de código, sem chamada real**

Sem credencial de sandbox Omie disponível nesta sessão (ver Global
Constraints), o Caminho B fica validado só por `tsc`/`build` (Tasks 7
e 8) e pela UI (Task 9) até que exista uma conta de teste real da Omie
pra usar. Registrar isso como pendência explícita — não marcar como
"testado" sem essa validação.

- [ ] **Step 5: Atualizar o spec com o resultado do teste ponta a ponta**

Adicionar uma seção "Testado em produção" no arquivo
`docs/superpowers/specs/2026-09-05-envio-nota-fiscal-omie-design.md`
com data, loja de teste usada, e o resultado exato encontrado no Step 3.
