# Correções das revisões independentes (2026-09-13) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Goal:** Fechar os achados reais das três revisões independentes de 2026-09-13 (tela branca, impressão, balcão "paga primeiro", atualização) e entregar os dois pedidos pendentes do cardápio do cliente.

**Architecture:** Nenhuma reforma estrutural. Cada tarefa é cirúrgica num ponto já existente: um ErrorBoundary novo no App Router, ajustes nos handlers do processo principal do Electron, uma migration de deduplicação em `print_jobs`, e correções pontuais em `StoreModule.tsx`/`ClientModule.tsx`/`lib/api.ts`. O princípio que guia todas: **falha silenciosa é pior que falha visível** — tudo que hoje "some sem avisar" passa a aparecer pro operador.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4, Supabase self-hosted (PostgREST + RPCs `security definer`), Electron 33 + electron-updater.

**Spec:** Este plano é a resposta direta a três relatórios de revisão independente feitos nesta sessão (2026-09-13) sobre os commits `22943b7`, `20a2edc`, `c60f532`, `ffb378a`, `4a16e3d`. Os achados estão citados dentro de cada tarefa — não existe outro documento de spec.

## Global Constraints

- **Este projeto NÃO tem framework de teste** (sem jest/vitest/playwright em `package.json`). Verificação = `npx tsc --noEmit`, `npm run build`, e teste AO VIVO (navegador via chrome-devtools, CDP no app Electron, ou consulta REST ao banco). Nenhuma tarefa pode ser dada como pronta só com typecheck.
- **Loja de teste é `zz-laboratorio`** (`f33b4310-ff0a-487c-a3b1-62acd0a58850`, nome real "ZZ Laboratorio (NAO E CLIENTE)"). NUNCA testar com dado de loja real de cliente. Usuário de QA: `qa-caixa-task4@zz-laboratorio.test` / `qa-teste-2026`.
- **Todo dado de teste criado tem que ser apagado ao fim da tarefa**, e toda flag de configuração ligada pra teste tem que ser revertida.
- **NUNCA emitir nota fiscal real.** Nenhuma tarefa aqui chama `/api/fiscal/emitir` com loja de cliente; se precisar, confirmar `ambiente=homologacao` antes.
- **`orders`, `order_items`, `tables` e `fiscal_notas` não têm SELECT anônimo** (migrations 021/022/031). Leitura desses dados no client é sempre por RPC `security definer`; em script de verificação, usar a service role de `.env.local` (`node --env-file=.env.local`).
- **Deploy após cada tarefa concluída**: `git push` + `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-vendas && ./deploy.sh"`. Publicar versão nova do app desktop só ao final (uma vez), não a cada tarefa.
- Comentário de código em português, explicando o PORQUÊ (o achado que motivou), no padrão já usado no repo.
- Não reverter nem "limpar" as correções já feitas hoje (reserva atômica de `print_jobs`, guarda `payment_details is null` na rota de pagamento) — elas já estão em produção e testadas.

---

## File Structure

| Arquivo | Responsabilidade | Tarefas |
|---|---|---|
| `app/global-error.tsx` (criar) | Último anteparo do App Router: erro no layout raiz | T1 |
| `app/error.tsx` (criar) | Erro de render dentro da página — é ESTE que pega a "tela branca ao voltar pra telas" | T1 |
| `desktop/electron/main.js` | Trava de recarga que desarma de verdade + aviso na tela | T2 |
| `components/modules/CaixaPrintStation.tsx` | Corte de ativação persistido; alarme que não se cala sozinho | T3 |
| `supabase/migrations/073_dedupe_print_jobs.sql` (criar) | Chave de deduplicação server-side de trabalho de impressão | T4 |
| `lib/api.ts` | `enqueuePrintJob` com `dedupeKey`; estorno; entrega x pagamento offline | T4, T5, T7 |
| `components/modules/StoreModule.tsx` | Botão de estorno; aviso de pedido pago não entregue; botão de atualizar com menu recolhido | T5, T6, T8 |
| `app/api/orders/pagamento-balcao/route.ts` | Suporte a estorno (limpar pagamento) | T5 |
| `lib/offline/sync.ts` | Entrega não fecha venda cujo pagamento falhou em definitivo | T7 |
| `components/DesktopUpdateBanner.tsx` | Mostrar falha de download, não só sucesso | T8 |
| `components/modules/ClientModule.tsx` | Barra "pedir a conta" grande; entrada PIN x só ver cardápio | T9, T10 |

---

### Task 1: Tela branca de verdade — ErrorBoundary do App Router

**Por que:** A revisão independente mostrou que os três handlers que entraram em `ffb378a` (renderer morto, travado, falha de carregamento) **não cobrem o sintoma relatado pela loja** ("voltando para telas tá dando tela branca"): navegação client-side com o renderer VIVO e o React estourando no render. Confirmado que o projeto não tem `app/error.tsx`, `app/global-error.tsx` nem nenhum ErrorBoundary. Sem isso, um erro de render desmonta a árvore e sobra tela branca — no navegador E no app desktop.

**Files:**
- Create: `app/error.tsx`
- Create: `app/global-error.tsx`

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: nada que outra tarefa consuma.

- [ ] **Step 1: Confirmar que hoje a falha é mesmo tela branca**

Rode `npm run dev` e, com o app aberto em `http://localhost:3000/loja`, force um erro de render no console do navegador não é possível — em vez disso, comprove pelo código: `grep -rn "ErrorBoundary\|componentDidCatch" app components | grep -v node_modules`. Esperado: nenhum resultado. Anote esse resultado como a prova do "antes".

- [ ] **Step 2: Criar `app/error.tsx`**

```tsx
'use client';

import { useEffect } from 'react';

// Tela branca ao trocar de aba/tela (relatado pela loja em 2026-09-11 e
// confirmado por revisão independente em 2026-09-13): sem nenhum
// ErrorBoundary, um erro de render em qualquer componente desmonta a árvore
// inteira e o operador fica com a tela BRANCA, sem mensagem, sem botão, sem
// pista — no navegador e dentro do app desktop. Os handlers do Electron
// (render-process-gone/unresponsive/did-fail-load) não pegam este caso: o
// processo está vivo e a página responde.
//
// Aqui o React entrega o erro em vez de sumir com tudo: mostra o que houve,
// registra no console (fica no log do app desktop) e oferece "tentar de
// novo" (reset() remonta só a rota, sem perder a sessão) e "recarregar".
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[NTB] erro de render capturado pelo ErrorBoundary:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="max-w-md w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-lg)] p-6 text-center">
        <h1 className="text-lg font-bold text-[var(--text)] mb-2">A tela travou, mas nada foi perdido</h1>
        <p className="text-sm text-[var(--text-muted)] mb-1">
          Seus pedidos e sua conta continuam salvos no servidor. Toque abaixo pra voltar.
        </p>
        <p className="text-[11px] text-[var(--text-muted)] mb-5 select-text">
          Detalhe técnico: {error.message}{error.digest ? ` (${error.digest})` : ''}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => reset()}
            className="flex-1 h-11 rounded-[var(--r-md)] bg-[var(--brand)] text-white font-semibold"
          >
            Tentar de novo
          </button>
          <button
            onClick={() => window.location.reload()}
            className="flex-1 h-11 rounded-[var(--r-md)] border border-[var(--border)] text-[var(--text)] font-semibold"
          >
            Recarregar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Criar `app/global-error.tsx`**

```tsx
'use client';

// Anteparo final: erro no PRÓPRIO layout raiz não é pego por app/error.tsx.
// Precisa trazer <html>/<body> porque substitui o layout inteiro. Sem
// estilo do design system aqui de propósito — se o layout raiz quebrou, os
// tokens de tema podem não ter carregado.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>O aplicativo precisou reiniciar a tela</h1>
        <p style={{ fontSize: 14, color: '#666' }}>Seus dados continuam salvos no servidor.</p>
        <p style={{ fontSize: 11, color: '#999' }}>{error.message}{error.digest ? ` (${error.digest})` : ''}</p>
        <button onClick={() => reset()} style={{ marginTop: 16, padding: '12px 20px', fontSize: 15, borderRadius: 8 }}>
          Tentar de novo
        </button>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verificar que o build estático do app desktop aceita os dois arquivos**

Run: `npx tsc --noEmit && npm run build`
Esperado: sem erro. `app/error.tsx` e `app/global-error.tsx` aparecem na saída do build como parte das rotas.

- [ ] **Step 5: Provar AO VIVO que a tela branca virou mensagem**

Crie um arquivo temporário `app/teste-erro/page.tsx` que estoura no render:

```tsx
'use client';
export default function TesteErro(): React.ReactElement {
  throw new Error('erro proposital de teste do ErrorBoundary');
}
```

Rode `npm run dev`, abra `http://localhost:3000/teste-erro` no navegador (chrome-devtools MCP) e tire um snapshot. Esperado: o texto "A tela travou, mas nada foi perdido" e os dois botões — NÃO uma tela em branco. Clique em "Tentar de novo" e confirme que a página tenta remontar.
Em seguida **apague `app/teste-erro/`** (não pode sobrar no repo).

- [ ] **Step 6: Commit**

```bash
git add app/error.tsx app/global-error.tsx
git commit -m "fix: tela branca vira mensagem com saida (ErrorBoundary do App Router)"
```

---

### Task 2: A trava de recarga precisa desarmar de verdade — e avisar quem está na frente

**Por que:** Revisão independente: em `desktop/electron/main.js`, `recargas` é uma janela deslizante de 60s e o caminho recusado (`return`) **não registra timestamp**. Resultado: 3 recargas, para, 61s depois volta a recarregar — pra sempre, a 3/min, moendo CPU num PC fraco. E quando desiste, a janela fica branca **sem nenhum aviso** pro operador. Além disso falta `isDestroyed()` antes do `reload()`/`loadURL()` em `setTimeout` (a janela pode ter sido fechada, inclusive por `quitAndInstall`), o que joga `TypeError: Object has been destroyed` no processo principal.

**Files:**
- Modify: `desktop/electron/main.js` (bloco `render-process-gone`, `did-fail-load`)

**Interfaces:**
- Consumes: `logRenderer(msg)` (já existe).
- Produces: nada que outra tarefa consuma.

- [ ] **Step 1: Trocar a lógica de recarga por uma que desarma de verdade**

Substituir o handler `render-process-gone` por:

```js
  let recargas = [];
  let desistiuDeRecarregar = false;
  win.webContents.on('render-process-gone', (_event, details) => {
    logRenderer(`ERROR renderer morreu (motivo=${details.reason}, exitCode=${details.exitCode})`);
    if (win.isDestroyed()) return;
    if (desistiuDeRecarregar) {
      logRenderer('ERROR ja tinha desistido de recarregar — nao tenta de novo');
      return;
    }
    const agora = Date.now();
    recargas = recargas.filter((t) => agora - t < 60_000);
    // A tentativa RECUSADA também entra na conta (era o bug: sem isto, a
    // janela deslizante esvaziava sozinha em 60s e o app voltava a
    // recarregar pra sempre, a 3 por minuto, em vez de desistir).
    recargas.push(agora);
    if (recargas.length > 3) {
      desistiuDeRecarregar = true;
      logRenderer('ERROR 3 recargas em 1 min sem resolver — desistindo de vez');
      // Falhar em silêncio deixaria o operador olhando pra uma tela branca
      // sem saber que o app desistiu. Diálogo nativo do SO porque neste
      // ponto NÃO existe página viva pra mostrar qualquer coisa.
      dialog.showErrorBox(
        'Norte Vendas',
        'O aplicativo travou várias vezes seguidas e não conseguiu se recuperar sozinho.\n\n' +
        'Feche e abra o aplicativo. Se continuar acontecendo, chame o suporte e mande o arquivo renderer.log.'
      );
      return;
    }
    logRenderer('INFO recarregando a janela sozinho');
    win.webContents.reload();
  });
```

E adicionar `dialog` no require do topo do arquivo:

```js
const { app, BrowserWindow, Menu, protocol, net, shell, Notification, ipcMain, dialog } = require('electron');
```

- [ ] **Step 2: Proteger o `setTimeout` do `did-fail-load` contra janela destruída**

No handler `did-fail-load`, trocar o corpo do `setTimeout` por:

```js
    setTimeout(() => {
      // A janela pode ter sido fechada nesses 2s (inclusive por
      // quitAndInstall durante uma atualização) — mexer num BrowserWindow
      // destruído lança TypeError no processo principal.
      if (win.isDestroyed()) return;
      logRenderer('INFO tentando carregar de novo');
      win.loadURL('app://bundle/index.html');
    }, 2000);
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check desktop/electron/main.js`
Esperado: sem saída (ok).

- [ ] **Step 4: Provar AO VIVO que agora desiste depois de 3 e avisa**

```bash
pkill -9 -f "ntb vendas/desktop/node_modules/electron"
rm -f "$HOME/Library/Application Support/Norte Vendas/renderer.log"
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas/desktop" && (npx electron . > /tmp/el.log 2>&1 &)
```
Espere 10s. Depois mate o renderer 4 vezes seguidas, com ~3s entre elas:
```bash
for i in 1 2 3 4; do
  PID=$(ps aux | grep "[-]-type=renderer" | grep "ntb vendas" | awk '{print $2}' | head -1)
  [ -n "$PID" ] && kill -9 $PID
  sleep 4
done
cat "$HOME/Library/Application Support/Norte Vendas/renderer.log"
```
Esperado no log: 3 linhas "recarregando a janela sozinho" e depois "desistindo de vez" — e uma caixa de erro nativa na tela. Confirme também que NÃO aparece uma 4ª recarga 60s depois (espere 70s e releia o log).
Encerre o app ao final: `pkill -9 -f "ntb vendas/desktop/node_modules/electron"`.

- [ ] **Step 5: Avisar na tela quando o app se recuperou sozinho**

Achado de revisão independente: a recuperação é 100% silenciosa. Se o caixa
estava no meio de um pagamento dividido, a tela pisca e volta limpa — do
ponto de vista dele, **indistinguível de "o pagamento foi"**. (O estado já
tinha morrido junto com o renderer; recarregar não é o que perde, mas
apresentar como se nada tivesse acontecido é.)

Em `main.js`, depois do `win.webContents.reload()`, avisar a página assim que
ela terminar de carregar:

```js
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      win.webContents.send('ntb-recuperou-de-falha');
    });
```

Em `desktop/electron/preload.js`, expor:

```js
  onRecuperouDeFalha: (callback) => {
    ipcRenderer.on('ntb-recuperou-de-falha', () => callback());
  },
```

Em `components/DesktopUpdateBanner.tsx` (já é o componente de avisos do app
desktop, montado no layout), assinar esse evento e mostrar uma faixa fixa:
"O aplicativo travou e se recuperou sozinho. Confira se a última coisa que
você estava fazendo foi concluída." — com um botão "Entendi" que a esconde.
Declarar `onRecuperouDeFalha?: (callback: () => void) => void;` no tipo de
`window.electronApp` em `lib/api.ts`.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/main.js desktop/electron/preload.js components/DesktopUpdateBanner.tsx lib/api.ts
git commit -m "fix(desktop): trava de recarga desarma de vez e avisa o operador"
```

---

### Task 3: Depois de recarregar, a impressão da cozinha precisa voltar

**Por que:** Revisão independente: `activatedAtRef` é redefinido em TODO mount para `Date.now() - 5min` (`activationCutoffNow()`, `components/modules/CaixaPrintStation.tsx:152` e `:485`). Numa loja `direct_print`, todo item pendente criado há mais de 5 minutos do reload cai abaixo do corte e **nunca mais é candidato ao auto-print**. O cenário é exatamente o pior: renderer morre, fica minutos morto acumulando pedidos, o app recarrega sozinho (Task 2 / commit `ffb378a`), a tela volta bonita — e os tickets daquela janela não saem. Pior: `failedRef`/`persistentReconcileFailure` também zeram, então o alarme de "impressão quebrada" **se cala sozinho** no reload mesmo se continuar quebrada.

**Files:**
- Modify: `components/modules/CaixaPrintStation.tsx` (perto de `activationCutoffNow`, `:152`; e o `useRef`/efeito de troca de loja, `:485`-`:500`)

**Interfaces:**
- Consumes: `printedIdsKey(storeId, destination)` e o padrão `STORAGE_PREFIX` já existentes no arquivo.
- Produces: nada que outra tarefa consuma.

- [ ] **Step 1: Persistir o corte de ativação por loja**

Adicionar, logo depois de `activationCutoffNow()`:

```ts
// O corte de ativação precisa sobreviver a um reload da MESMA sessão de
// trabalho. Achado de revisão independente (2026-09-13): ele nascia sempre
// de `Date.now() - 5min`, então quando o app se recarrega sozinho depois de
// uma falha (ver desktop/electron/main.js, render-process-gone), tudo que
// entrou na fila enquanto a tela estava morta ficava velho demais pro corte
// e NUNCA era impresso — o operador via a tela voltar ao normal e a cozinha
// simplesmente não recebia aqueles pedidos.
// Guardar o corte por loja resolve: uma sessão que já estava ativa retoma o
// corte antigo (e alcança o backlog), e só uma sessão de fato NOVA (outro
// aparelho, localStorage limpo) cria corte novo.
const ACTIVATION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function activationCutoffKey(storeId: string) {
  return `${STORAGE_PREFIX}_corte_ativacao_${storeId}`;
}

function loadOrCreateActivationCutoff(storeId: string): string {
  if (!isBrowser()) return activationCutoffNow();
  try {
    const salvo = window.localStorage.getItem(activationCutoffKey(storeId));
    // Corte muito antigo (o PDV ficou dias desligado) volta a ser "agora":
    // aí sim queremos o corte protegendo contra despejo de backlog velho.
    if (salvo && Date.now() - new Date(salvo).getTime() < ACTIVATION_MAX_AGE_MS) return salvo;
    const novo = activationCutoffNow();
    window.localStorage.setItem(activationCutoffKey(storeId), novo);
    return novo;
  } catch {
    return activationCutoffNow();
  }
}
```

- [ ] **Step 2: Usar o corte persistido no mount e na troca de loja**

Em `:485`, trocar `const activatedAtRef = useRef<string>(activationCutoffNow());` por um valor que será definido pelo efeito (a loja só é conhecida lá):

```ts
  const activatedAtRef = useRef<string>(activationCutoffNow());
```
mantém-se como está (valor provisório), e no efeito de troca de loja (`:499`), trocar
`activatedAtRef.current = activationCutoffNow();` por:
```ts
    // Ver loadOrCreateActivationCutoff: retoma o corte da sessão anterior
    // desta loja quando existir (reload/recuperação de falha), em vez de
    // descartar o backlog acumulado enquanto a tela esteve fora do ar.
    activatedAtRef.current = loadOrCreateActivationCutoff(s.id);
```
(usar o identificador de loja que já está em escopo nesse efeito — o mesmo usado em `printedIdsRef`/`loadPrintedIds`.)

- [ ] **Step 3: Fazer o alarme de falha persistente sobreviver ao reload**

Localizar onde `failedRef` e o estado de falha persistente são inicializados (perto de `:467-474`) e persistir o contador por loja, no mesmo padrão:

```ts
function falhaPersistenteKey(storeId: string) {
  return `${STORAGE_PREFIX}_falha_impressao_${storeId}`;
}
```
Ao acender o alarme, gravar `window.localStorage.setItem(falhaPersistenteKey(storeId), '1')`; ao ter uma reconciliação bem-sucedida, `removeItem`. No mount, ler essa chave pra decidir o estado inicial do alarme.
Motivo (comentar no código): sem isso, o reload automático **apagava o alarme de impressão quebrada** — o problema continuava e o aviso sumia.

- [ ] **Step 4: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Esperado: sem erro.

- [ ] **Step 5: Provar AO VIVO que o backlog é alcançado depois do reload**

Com `npm run dev` e a loja `zz-laboratorio` (é `direct_print`), logado como o usuário de QA:
1. Abra a aba Caixa e deixe a estação de impressão ativa.
2. Crie um pedido de mesa via RPC (script node com `create_order_secure`, `p_order_type: 'table'`) e confirme no `localStorage` que a chave `..._corte_ativacao_<storeId>` existe.
3. Anote o valor do corte. Recarregue a página (F5).
4. Confirme, lendo o `localStorage` de novo, que o corte é **o mesmo** (não avançou pra "agora").
Apague o pedido de teste ao final.

- [ ] **Step 6: Commit**

```bash
git add components/modules/CaixaPrintStation.tsx
git commit -m "fix(impressao): corte de ativacao e alarme sobrevivem ao reload"
```

---

### Task 4: Dois PCs não podem mais criar dois trabalhos pro mesmo item

**Por que:** A reserva atômica que entrou hoje impede dois computadores de imprimirem o MESMO job — mas a revisão independente apontou que o problema começa antes: o dedupe do `CaixaPrintStation` é `localStorage` **por aparelho** (`printedIds`), então dois PCs logados na mesma loja criam **duas linhas** em `print_jobs` pro mesmo item. Reserva atômica não ajuda: são jobs distintos. Precisa de dedupe no servidor.

**Files:**
- Create: `supabase/migrations/073_dedupe_print_jobs.sql`
- Modify: `lib/api.ts` (`enqueuePrintJob`, `:2447`)
- Modify: quem chama `enqueuePrintJob` com ticket de item: `components/modules/CaixaPrintStation.tsx`

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `enqueuePrintJob({ ..., dedupeKey?: string })` — T-nenhuma depende, mas mantenha o nome exato.

- [ ] **Step 1: Escrever a migration**

```sql
-- Dedupe server-side de trabalho de impressão (achado de revisão
-- independente, 2026-09-13). O dedupe existente vive no localStorage de
-- CADA aparelho (CaixaPrintStation.printedIds), então dois computadores com
-- o app aberto na mesma loja criam DOIS print_jobs para o mesmo item — e a
-- reserva atômica do motor de impressão não resolve isso, porque são jobs
-- diferentes, cada um legitimamente reservado por uma máquina.
-- Chave opcional: job sem `dedupe_key` (teste manual, comprovante avulso)
-- continua podendo repetir à vontade.
alter table print_jobs add column if not exists dedupe_key text;

create unique index if not exists print_jobs_dedupe_key_uniq
  on print_jobs (store_id, dedupe_key)
  where dedupe_key is not null;
```

- [ ] **Step 2: Aplicar a migration e confirmar no banco**

Run: `node scripts/aplicar-migration.mjs 073_dedupe_print_jobs.sql`
Se o script exigir `SUPABASE_DB_URL` (que não está no `.env.local`), aplicar via `psql` no Contabo:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
  "docker exec -i supabase-db-vendas psql -U postgres -d postgres" < supabase/migrations/073_dedupe_print_jobs.sql
```
Depois confirme a coluna e o índice:
```bash
node --env-file=.env.local -e "
const u=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
fetch(u+'/rest/v1/print_jobs?select=dedupe_key&limit=1',{headers:{apikey:k,Authorization:'Bearer '+k}}).then(r=>console.log('coluna dedupe_key:',r.status));"
```
Esperado: `200`. Se der 400, o PostgREST ainda não recarregou o schema — rodar `NOTIFY pgrst, 'reload schema'` (ver AGENTS.md).

- [ ] **Step 3: Aceitar `dedupeKey` em `enqueuePrintJob`**

```ts
export const enqueuePrintJob = async (params: {
  storeId: string;
  printerConfigId?: string | null;
  destination: 'kitchen' | 'bar' | 'all' | 'receipt';
  title: string;
  content: string;
  // Ver migration 073: quando informada, o banco garante que o MESMO
  // trabalho não entra duas vezes na fila — é o que impede dois PCs da
  // mesma loja de mandarem a mesma comanda pra cozinha (o dedupe antigo era
  // localStorage, por aparelho).
  dedupeKey?: string;
}): Promise<{ success: boolean; id?: string; message?: string; duplicado?: boolean }> => {
  const { data, error } = await supabase.from('print_jobs').insert({
    store_id: params.storeId,
    printer_config_id: params.printerConfigId || null,
    destination: params.destination,
    title: params.title,
    content: params.content,
    dedupe_key: params.dedupeKey || null,
  }).select('id').single();
  if (error) {
    // 23505 = unique_violation: outro aparelho já enfileirou este mesmo
    // trabalho. É o comportamento desejado, não um erro pra reportar.
    if ((error as { code?: string }).code === '23505') return { success: true, duplicado: true };
    console.error('Error enqueueing print job:', error);
    return { success: false, message: error.message };
  }
  return { success: true, id: data?.id };
};
```

- [ ] **Step 4: Passar a chave nos tickets de item da estação de impressão**

Em `components/modules/CaixaPrintStation.tsx`, onde o ticket de cozinha/bar é enfileirado para impressora de rede/USB, adicionar `dedupeKey` combinando item + destino + impressora:

```ts
  dedupeKey: `item:${item.id}:${destination}:${printer.id}`,
```
(usar os identificadores já em escopo naquele ponto; se o nome da variável do item for outro, manter o padrão `item:<id do order_item>:<destino>:<id da impressora>`.)

- [ ] **Step 5: Provar AO VIVO que o segundo insert é recusado**

```bash
node --env-file=.env.local -e "
const u=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S='f33b4310-ff0a-487c-a3b1-62acd0a58850';
const h={apikey:k,Authorization:'Bearer '+k,'Content-Type':'application/json'};
const criar=()=>fetch(u+'/rest/v1/print_jobs',{method:'POST',headers:{...h,Prefer:'return=representation'},body:JSON.stringify({store_id:S,destination:'kitchen',title:'dedupe',content:'x',status:'pending',dedupe_key:'teste-dedupe-1'})}).then(async r=>({status:r.status}));
(async()=>{
 console.log('PC A:',JSON.stringify(await criar()));
 console.log('PC B:',JSON.stringify(await criar()));
 await fetch(u+'/rest/v1/print_jobs?dedupe_key=eq.teste-dedupe-1',{method:'DELETE',headers:h});
 console.log('limpo');
})();"
```
Esperado: `PC A: 201` e `PC B: 409` (unique violation).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/073_dedupe_print_jobs.sql lib/api.ts components/modules/CaixaPrintStation.tsx
git commit -m "fix(impressao): dedupe no servidor impede dois PCs enfileirarem a mesma comanda"
```

---

### Task 5: Estorno de pagamento de balcão

**Por que:** Revisão independente: separar "receber" de "entregar" criou uma janela em que o pedido está **pago e aberto** — e não existe nenhum caminho pra desfazer (o cliente desistiu, o caixa cobrou o pedido errado, a maquininha recusou depois). Antes isso não existia porque pagar e fechar eram o mesmo clique. Sem estorno, a única saída é mexer no banco à mão.

**Files:**
- Modify: `app/api/orders/pagamento-balcao/route.ts` (aceitar `estornar: true`)
- Modify: `lib/api.ts` (`estornarPagamentoBalcao`)
- Modify: `components/modules/StoreModule.tsx` (CounterView: botão "Estornar" no card pago)

**Interfaces:**
- Consumes: `pedidoJaPago(order)` (já existe no CounterView).
- Produces: `estornarPagamentoBalcao(orderId: string): Promise<void>` em `lib/api.ts`.

- [ ] **Step 1: Aceitar estorno na rota**

No início do handler, depois de validar `orderId`, tratar o caso de estorno antes da validação de `paymentDetails`:

```ts
  // Estorno: limpa o pagamento de um pedido de balcão que ainda NÃO foi
  // entregue. Existe porque o fluxo "paga primeiro" criou uma janela real
  // entre receber e entregar (cliente desiste, caixa cobrou o pedido
  // errado, maquininha recusou depois). Nunca toca em pedido já entregue —
  // desfazer venda fechada é outro problema, com implicação fiscal.
  if (body.estornar === true) {
    const { data: estornado, error: erroEstorno } = await admin
      .from('orders')
      .update({ payment_method: null, payment_details: null, updated_at: new Date().toISOString() })
      .eq('id', body.orderId)
      .eq('order_type', 'counter')
      .neq('status', 'delivered')
      .neq('status', 'canceled')
      .select('id')
      .maybeSingle();
    if (erroEstorno) {
      console.error('pagamento-balcao: falha ao estornar:', erroEstorno);
      return NextResponse.json({ success: false, message: 'Falha ao estornar o pagamento.' }, { status: 500 });
    }
    if (!estornado) {
      return NextResponse.json(
        { success: false, message: 'Pedido não encontrado ou já entregue — não dá pra estornar.' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, estornado: true });
  }
```

Incluir `estornar?: boolean` no tipo do corpo da requisição.

- [ ] **Step 2: Expor no `lib/api.ts`**

```ts
// Desfaz o pagamento de um pedido de balcão ainda não entregue (ver a rota).
// NÃO é fire-and-forget nem tem caminho offline de propósito: estorno mexe
// em dinheiro já registrado no turno, então ou acontece agora, com a
// confirmação do servidor, ou o operador precisa saber que não aconteceu.
export const estornarPagamentoBalcao = async (orderId: string): Promise<void> => {
  const res = await fetch(resolverUrlApi('/api/orders/pagamento-balcao'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, estornar: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || 'Falha ao estornar o pagamento.');
  }
};
```

- [ ] **Step 3: Botão no card pago do Balcão**

No CounterView, no ramo em que `pedidoJaPago(order)` é verdadeiro, ao lado de "Entregar":

```tsx
                                     <button
                                         type="button"
                                         onClick={async () => {
                                             if (!(await confirm(`Estornar o pagamento de ${order.customer_name || 'Cliente'}? O pedido volta a aparecer como não pago.`))) return;
                                             try {
                                                 await estornarPagamentoBalcao(order.id);
                                                 toast.success('Pagamento estornado.');
                                                 load();
                                             } catch (e: any) {
                                                 toast.error(e?.message || 'Não consegui estornar.');
                                             }
                                         }}
                                         className="h-10 px-3 rounded-[var(--r-md)] border border-[var(--border)] text-xs font-bold text-[var(--text-muted)] hover:text-[var(--err)] u-motion shrink-0"
                                         title="Estornar pagamento"
                                     >
                                         Estornar
                                     </button>
```
Só renderizar quando `canFinalize` for verdadeiro (mesma permissão de quem recebe).

- [ ] **Step 4: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`

- [ ] **Step 5: Provar AO VIVO (rota + tela)**

Script: criar pedido de balcão na `zz-laboratorio`, pagar via rota, chamar a rota com `estornar: true`, e conferir `payment_details` de volta a `null`; depois pagar de novo e confirmar que agora é aceito (a guarda `payment_details is null` não trava um pedido estornado). Apagar o pedido ao final.
Na tela: com `counter_payment_first` ligado na loja de teste, receber um pedido, clicar em "Estornar", confirmar que o selo "Pago" some e o botão volta pra "Receber pagamento". Reverter a flag e apagar o pedido.

- [ ] **Step 6: Commit**

```bash
git add app/api/orders/pagamento-balcao/route.ts lib/api.ts components/modules/StoreModule.tsx
git commit -m "feat(balcao): estorno de pagamento de pedido ainda nao entregue"
```

---

### Task 6: Pedido pago e não entregue não pode ser invisível

**Por que:** Revisão independente: enquanto não é entregue, a venda **não aparece** no Histórico de Vendas (`fetch_sales_history_secure` filtra `status = 'delivered'`), mas **já entrou** no esperado em dinheiro do turno e **já gerou nota fiscal**. O card fica na tela do Balcão indefinidamente, atravessando turnos e dias (`fetch_counter_orders_secure` não tem filtro de data). Na prática: o CSV do contador e o relatório de vendas divergem, e ninguém percebe.

**Files:**
- Modify: `components/modules/StoreModule.tsx` (CaixaView: aviso; CounterView: idade do pedido no card)

**Interfaces:**
- Consumes: `counterOrders` (já carregado no CaixaView), `pedidoJaPago` (CounterView).
- Produces: nada.

- [ ] **Step 1: Card de aviso no Caixa**

No CaixaView, abaixo da fila "Aguardando pagamento", acrescentar um bloco que só existe quando há pedido pago e não entregue:

```tsx
                {(() => {
                    // Pedido pago e não entregue é um buraco de conferência: o
                    // dinheiro já está no turno e a nota já saiu, mas a venda
                    // NÃO aparece no Histórico de Vendas (que só conta
                    // 'delivered'). Sem este aviso, o caixa fecha o turno sem
                    // saber que existe venda pendurada — e o relatório do
                    // contador não bate com o do dia.
                    const pagosNaoEntregues = counterOrders.filter(o => !!o.payment_details);
                    if (pagosNaoEntregues.length === 0) return null;
                    const total = pagosNaoEntregues.reduce((s, o) =>
                        s + (o.order_items || []).filter(i => i.status !== 'canceled')
                            .reduce((a, i) => a + i.price_at_time * i.quantity, 0), 0);
                    return (
                        <Card className="p-3 bg-[var(--warn)]/10 border-[var(--warn)]/30">
                            <p className="text-xs font-bold text-[var(--warn)] uppercase tracking-wide mb-1">
                                Pago e ainda não entregue ({pagosNaoEntregues.length})
                            </p>
                            <p className="text-[12px] text-[var(--text-muted)]">
                                R$ {formatBRL(total)} já recebido, esperando entrega no Balcão. Esse valor está no seu
                                caixa, mas só entra no histórico de vendas depois que o pedido for entregue.
                            </p>
                        </Card>
                    );
                })()}
```

- [ ] **Step 2: Mostrar há quanto tempo o pedido pago está esperando**

No card do CounterView, junto do selo "Pago", quando o pedido já estiver pago há mais de 30 minutos, acrescentar um aviso visual (ex.: texto `Pago há Xh` em `var(--warn)`), calculado a partir de `order.created_at`. Usar `Math.round((Date.now() - new Date(order.created_at).getTime()) / 60000)`.

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`

- [ ] **Step 4: Provar AO VIVO**

Na loja de teste com a flag ligada: criar 1 pedido, receber, ir pra aba Caixa e confirmar que o card amarelo aparece com o valor certo; entregar e confirmar que o card some. Reverter flag e apagar dado.

- [ ] **Step 5: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat(caixa): avisa venda paga e ainda nao entregue no fechamento"
```

---

### Task 7: Offline — entrega não pode fechar venda cujo pagamento falhou de vez

**Por que:** Revisão independente: separar pagar de entregar transformou uma ação atômica da fila offline em duas independentes. Se `registrar_pagamento_balcao` falhar `MAX_ATTEMPTS` vezes, ela é marcada como falha e **pulada pra sempre** — mas a ação `close_counter_order` enfileirada pela entrega roda normalmente e marca o pedido como `delivered`. Resultado: venda entregue, no histórico, com `payment_method`/`payment_details` **nulos** — fora do turno de caixa e fora de qualquer conferência.

**Files:**
- Modify: `lib/offline/sync.ts` (case `close_counter_order`)

**Interfaces:**
- Consumes: os tipos de ação em `lib/offline/types.ts` (`registrar_pagamento_balcao`, `close_counter_order`).
- Produces: nada.

- [ ] **Step 1: Ler o mecanismo atual de falha**

Leia `lib/offline/sync.ts` inteiro e anote: como as ações são listadas, como `attempts`/`MAX_ATTEMPTS` funcionam, e como uma ação é marcada como falha (`markFailed`).

- [ ] **Step 2: Antes de fechar, conferir se existe pagamento pendente/falho do mesmo pedido**

No `case 'close_counter_order'`, antes de chamar a RPC, verificar na própria fila se há ação `registrar_pagamento_balcao` para o mesmo `orderId` ainda não concluída (pendente OU marcada como falha). Se houver falha definitiva, **não fechar**: marcar esta ação como falha também, com mensagem clara, pra não gerar venda sem pagamento.

```ts
      // Entregar fecha a venda; pagar registra o dinheiro. Offline, as duas
      // viraram ações independentes da fila — e se o pagamento falhar em
      // definitivo, fechar assim mesmo produziria uma venda ENTREGUE sem
      // pagamento nenhum (fora do turno, fora da conferência do caixa).
      // Achado de revisão independente, 2026-09-13.
      const pagamentoPendente = todasAsAcoes.find(
        (a) => a.type === 'registrar_pagamento_balcao' && a.payload?.orderId === action.payload.orderId
      );
      if (pagamentoPendente) {
        throw new Error('Pagamento deste pedido ainda não sincronizou — entrega adiada até o pagamento entrar.');
      }
```
(adaptar `todasAsAcoes` ao nome real da lista já carregada na função de drenagem; se a função só recebe uma ação por vez, carregar a fila com o helper que `sync.ts` já usa.)

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`

- [ ] **Step 4: Provar AO VIVO com a rede desligada**

No navegador (chrome-devtools), com a loja de teste em `counter_payment_first`:
1. Criar um pedido de balcão.
2. Ativar offline (emulate network `offline` ou desligar o Wi-Fi da máquina).
3. Receber o pagamento → confirmar que o card mostra "Pago" (cache otimista, já implementado hoje).
4. Entregar → a ação vai pra fila.
5. Voltar online e confirmar, no banco, que o pedido terminou `delivered` **com** `payment_details` preenchido (a ordem foi respeitada).
Apagar o dado de teste e reverter a flag.

- [ ] **Step 5: Commit**

```bash
git add lib/offline/sync.ts
git commit -m "fix(offline): entrega espera o pagamento sincronizar antes de fechar a venda"
```

---

### Task 8: Atualização — falha de download precisa aparecer

**Por que:** Revisão independente: `situacao`/`detalhe`/`empacotado` do IPC `ntb-update-status` **não são lidos em lugar nenhum** (o banner lê só `versaoBaixada`). Se a rede da loja cair no meio do download, o operador não fica sabendo de jeito nenhum: o toast prometeu "o aviso aparece assim que terminar", o erro vai só pro `update.log`, e clicar de novo repete a mesma promessa. Além disso: clicar "procurar atualização" com update já baixado dispara `update-downloaded` de novo (notificação duplicada + toast mentiroso), e o botão some quando a barra lateral está recolhida.

**Files:**
- Modify: `desktop/electron/main.js` (`ntb-check-update`: não rechecar se já há versão baixada)
- Modify: `components/DesktopUpdateBanner.tsx` (mostrar estado de erro)
- Modify: `components/modules/StoreModule.tsx` (botão também com a barra recolhida)

**Interfaces:**
- Consumes: `window.electronApp.getUpdateStatus()` → `{ versaoAtual, versaoBaixada, situacao, detalhe, empacotado }` (já existe).
- Produces: nada.

- [ ] **Step 1: Não rechecar quando já existe versão baixada**

No `ipcMain.handle('ntb-check-update', ...)`, antes de chamar `autoUpdater.checkForUpdates()`:

```js
    // Rechecar com uma versão já BAIXADA faz o electron-updater reemitir
    // 'update-downloaded' (acha o arquivo no cache): segunda notificação do
    // sistema e um toast dizendo "baixando" quando não há nada baixando.
    if (estadoUpdate.versaoBaixada) {
      return { ok: true, empacotado: true, versaoDisponivel: estadoUpdate.versaoBaixada, jaBaixada: true };
    }
```

- [ ] **Step 2: Banner mostra falha, não só sucesso**

Em `DesktopUpdateBanner.tsx`, guardar também a situação e renderizar uma variante de erro quando `situacao === 'erro'` (texto: "Não consegui baixar a atualização — vou tentar de novo sozinho." + o detalhe), consultando `getUpdateStatus()` no mount e a cada 60s enquanto a janela estiver aberta.

- [ ] **Step 3: Toast do botão reflete "já baixada"**

Em `handleProcurarAtualizacao` (`StoreModule.tsx`), tratar `r.jaBaixada`:
```ts
      } else if (r.jaBaixada) {
        toast.success(`A versão ${r.versaoDisponivel} já está baixada — é só clicar em "Atualizar agora" no aviso.`);
```

- [ ] **Step 4: Botão visível com a barra lateral recolhida**

Na variante desktop do `StoreLayout`, quando `isCollapsed` for verdadeiro, renderizar um botão compacto só com o ícone (e `title` explicando), em vez de esconder por completo.

- [ ] **Step 5: Verificar**

Run: `node --check desktop/electron/main.js && npx tsc --noEmit && npm run build`
Ao vivo (app desktop via CDP, como já feito nesta sessão): confirmar que `getUpdateStatus()` responde e que o botão aparece nas duas variantes da barra lateral.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/main.js components/DesktopUpdateBanner.tsx components/modules/StoreModule.tsx
git commit -m "fix(desktop): falha de download de atualizacao fica visivel"
```

---

### Task 9: Cardápio — "pedir a conta" deixa de ser um ícone escondido

**Por que:** Pedido direto do dono (2026-09-13): "aumentar o botão de pedir conta que tá meio escondido". Hoje é um botão redondo de 36×36 **só com ícone** no canto do cabeçalho (`components/modules/ClientModule.tsx:3516`), do mesmo tamanho e cor do botão de busca — invisível pra quem está na mesa.

**Files:**
- Modify: `components/modules/ClientModule.tsx` (barra de sessão, `:3791`; botão do hero, `:3516`)

**Interfaces:**
- Consumes: `hasOpenTableOrders`, `isWaitingBill`, `mesaItemCount`, `setBillRequestIntent`, `setShowBill` (todos já existem no componente).
- Produces: nada.

- [ ] **Step 1: Transformar a barra "Comanda aberta" em ação de verdade**

Substituir o bloco de `:3791` por uma barra com o resumo à esquerda e um botão sólido à direita, com altura de toque de 44px:

```tsx
            {hasAccess && hasOpenTableOrders && (
                <div className="w-full bg-[var(--ink)] px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-white truncate">
                            {mesaItemCount > 0
                                ? `Comanda aberta • ${mesaItemCount} ${mesaItemCount === 1 ? 'item' : 'itens'}`
                                : 'Comanda aberta'}
                        </p>
                        <p className="text-[11px] text-white/50">
                            {isWaitingBill ? 'Conta pedida — o garçom está a caminho' : 'Quando terminar, peça a conta aqui'}
                        </p>
                    </div>
                    {/* Pedido direto do dono (2026-09-13): antes isto só existia
                        como um ícone de 36px no cabeçalho, do mesmo tamanho do
                        botão de busca — ninguém achava. Pedir a conta é a ÚLTIMA
                        coisa que todo cliente de mesa faz; merece ser o botão
                        mais óbvio da tela nesse momento. */}
                    <button
                        type="button"
                        onClick={() => { setBillRequestIntent(true); setShowBill(true); }}
                        className="shrink-0 h-11 px-4 rounded-full bg-white text-[var(--ink)] text-[14px] font-bold flex items-center gap-2 u-motion u-press-sm"
                    >
                        <Receipt size={16} />
                        {isWaitingBill ? 'Ver conta' : 'Pedir a conta'}
                    </button>
                </div>
            )}
```
Repare na mudança de condição: era `mesaOrders.length > 0`, passa a ser `hasOpenTableOrders` — que também cobre o caso "recarregou a página e a comanda existe no servidor" (`tableOrdersUnknown`/`isWaitingBill`), exatamente quando o cliente mais precisa do botão.

- [ ] **Step 2: Manter o ícone do cabeçalho como atalho secundário**

Não remover o botão do hero (`:3516`) — ele continua útil quando a barra sai da viewport ao rolar. Nenhuma mudança necessária.

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`

- [ ] **Step 4: Provar AO VIVO em largura de celular**

Com `npm run dev`, abrir `http://localhost:3000/c/zz-laboratorio` (ou o slug da loja de teste) no chrome-devtools com viewport de 390×844, entrar numa mesa, lançar um item e confirmar: a barra escura aparece com o botão branco "Pedir a conta", legível e com 44px de altura. **Tirar print e anexar ao relatório da tarefa.**

- [ ] **Step 5: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): pedir a conta vira botao grande na barra da comanda"
```

---

### Task 10: Cardápio — separar "entrar na mesa" de "só ver o cardápio"

**Por que:** Pedido direto do dono (2026-09-13): "ter o botão de também só pedir pin ou de só ver o cardápio, essas opções". Hoje existe um único botão vermelho "Abrir minha mesa ou comanda" que abre direto o `LoginScreen` pedindo nome + mesa + PIN. Quem só quer olhar o cardápio (ou quem já está na mesa e só precisa digitar o PIN) não tem caminho próprio — e quem chega pelo QR não entende se precisa se cadastrar pra ver preço.

**Files:**
- Modify: `components/modules/ClientModule.tsx` (banner de entrada, `:3764`-`:3781`)

**Interfaces:**
- Consumes: `setIsLoginModalOpen`, `hasAccess`, `currentTable` (já existem).
- Produces: nada.

- [ ] **Step 1: Trocar o botão único por duas escolhas explícitas**

```tsx
                            /* Pedido direto do dono (2026-09-13): "ter o botão
                               de também só pedir pin ou de só ver o cardápio".
                               Um botão só ("Abrir minha mesa ou comanda") não
                               dizia que dá pra navegar sem entrar — quem chega
                               pelo QR não sabe se precisa se identificar pra ver
                               preço. Agora as duas intenções têm caminho
                               próprio, e a de entrar continua sendo a primária
                               (cor cheia). "Só ver o cardápio" não é um modo
                               novo: é literalmente ficar onde já está, com o
                               banner fora do caminho. */
                            <div className="flex w-full gap-2">
                                <button
                                    type="button"
                                    onClick={() => setIsLoginModalOpen(true)}
                                    className="flex flex-1 items-center justify-center gap-2 rounded-[var(--r-md)] py-2.5 u-motion u-press-sm"
                                    style={{ backgroundColor: IFOOD_RED }}
                                >
                                    <LogIn size={16} className="flex-shrink-0 text-white" />
                                    <span className="text-[13px] font-bold text-white">Entrar na mesa (PIN)</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEntradaDispensada(true)}
                                    className="flex items-center justify-center gap-2 rounded-[var(--r-md)] border border-[var(--border)] px-3 py-2.5 u-motion u-press-sm"
                                >
                                    <span className="text-[13px] font-semibold text-[var(--text-muted)]">Só ver o cardápio</span>
                                </button>
                            </div>
```

- [ ] **Step 2: Guardar a dispensa do banner**

Adicionar, junto dos demais `useState` do componente do cardápio:

```tsx
    // "Só ver o cardápio" só esconde o convite de entrar — nada mais muda:
    // navegar sempre funcionou sem login. Fica por sessão (não em
    // localStorage) porque quem recarrega a página normalmente quer o
    // convite de volta: a intenção mais comum ao reabrir é pedir.
    const [entradaDispensada, setEntradaDispensada] = useState(false);
```
E na condição do banner, renderizar o bloco só quando `!entradaDispensada`. Quando dispensado, mostrar no lugar um link discreto ("Entrar na mesa") que devolve o convite (`setEntradaDispensada(false)`), pra ninguém ficar sem caminho de entrada.

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`

- [ ] **Step 4: Provar AO VIVO em largura de celular**

Com viewport 390×844 em `/c/<slug da loja de teste>`: confirmar que os dois botões aparecem lado a lado sem quebrar; clicar em "Só ver o cardápio" e confirmar que o banner some, o cardápio continua navegável e o link discreto de voltar aparece; clicar nele e confirmar que o convite volta; clicar em "Entrar na mesa (PIN)" e confirmar que o modal de login abre como antes. **Tirar print e anexar ao relatório da tarefa.**

- [ ] **Step 5: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): separar entrar na mesa de so ver o cardapio"
```

---

## Encerramento (depois da última tarefa)

- [ ] Rodar `npx tsc --noEmit && npm run build` uma última vez.
- [ ] Deploy do site: `git push` + `./deploy.sh` no Contabo.
- [ ] Publicar UMA versão nova do app desktop com tudo junto (bump em `desktop/package.json`, `npm run dist`, `scp` do `.exe` + `.blockmap` + `latest.yml` pra `/home/ntb/web/updates.norteparanegocios.com.br/public_html/ntb-vendas-desktop/`, `chown ntb:ntb`), e conferir o feed com `curl`.
- [ ] Confirmar que nenhuma loja real ficou com `counter_payment_first` ligado por acidente:
```bash
node --env-file=.env.local -e "
const u=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
fetch(u+'/rest/v1/stores?select=slug,config',{headers:{apikey:k,Authorization:'Bearer '+k}}).then(r=>r.json()).then(d=>console.log(d.filter(s=>s.config?.counter_payment_first).map(s=>s.slug)));"
```
- [ ] Confirmar que não sobrou dado de teste na `zz-laboratorio` (pedidos `QA%`, `printer_configs` de teste, `print_jobs` de teste).

## Pedido novo, para um plano próprio (2026-09-13)

- **App Android pra rodar na maquininha.** Pedido do dono: "transformar um app possível para Android para baixarmos em maquininha". Não entra neste plano (é projeto próprio, não correção). O que já dá pra adiantar do levantamento: a parte de TELA é quase de graça (maquininha é Android com WebView; um wrapper tipo TWA/Capacitor serve, e o app já é responsivo e funciona offline). O trabalho de verdade é a **impressora térmica embutida da maquininha**, que só é acessível por SDK nativo do fabricante (Sunmi, Gertec, Positivo, PAX) — cada um com biblioteca Java própria, e nenhuma alcançável de dentro de uma página web. Ou seja: precisa de uma casca Android nativa mínima expondo "imprimir" pro WebView, no mesmo espírito do que foi feito no Electron. **Pergunta que decide o resto: qual maquininha?** (Stone/PagSeguro/Cielo têm loja de aplicativos própria e regras próprias de publicação; uma Sunmi "pura" é a mais livre.)

## Fora deste plano (registrado de propósito)

- **Testar em Windows real.** Todo o app desktop segue validado por dedução num Mac — é o maior risco em aberto do projeto. Não é tarefa de código.
- **Corrigir o cadastro de impressora do Sertão** (`dscfwdefr3`, destinos `receipt`): é operação/configuração, feita pela tela, não por código.
- **Senha em texto puro** em `store_users`/`system_admins`: dívida conhecida e documentada no AGENTS.md; reforma grande, exige decisão do dono.
- **Job travado em `printing`** quando o app morre entre reservar e imprimir: hoje sai pelo botão "Reenviar" da aba Impressão. Recuperação automática exigiria distinguir "morreu antes de imprimir" de "imprimiu e não gravou" — e errar nisso reimprime comanda.
- **`print_agent_status` não distingue máquinas** (a chave é só `store_id`): com dois PCs, o painel não consegue dizer quantos motores estão de pé, e um PC morto continua aparecendo como conectado porque o outro manda heartbeat pela loja inteira. Exige coluna nova (migration) e decisão de como mostrar isso na aba Impressão — vale fazer, mas depois de confirmar o comportamento com dois terminais reais.
- **⚠️ Premissa a confirmar na loja antes de considerar o balcão "paga primeiro" entregue:** numa loja `direct_print` (Sertão), o item de balcão nasce `'pending'` e `fetch_kitchen_orders_secure` exclui de propósito `order_type='counter' and status='pending'` — e o botão "Enviar p/ Cozinha" não é renderizado nessa configuração. Ou seja, o passo "depois de pago vai pra cozinha" não tem mecanismo em `direct_print`: o pagamento não muda status de item. Não é regressão (é assim desde antes), mas é a premissa do fluxo de 2 passos do Sertão — **verificar ao vivo como o ticket de cozinha sai lá hoje** antes de ligar a chave na loja.
