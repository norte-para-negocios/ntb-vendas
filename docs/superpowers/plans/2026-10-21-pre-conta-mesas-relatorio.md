# Pré-conta sozinha, computador de mesas por loja e ranking por categoria — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** acabar com a pré-conta que sai sozinha na ODARA, prender o botão "Mesas · Sem login" a uma loja escolhida no computador, e dar filtro por categoria + espaçamento certo no ranking de produtos da Administração.

**Architecture:** três mudanças independentes no app Norte Vendas (Next.js, mesmo código no site, desktop Electron e Android). Cada regra nova vira uma função pura em `lib/` com teste em `scripts/testes/*.test.ts` (rodados com `npx tsx`); os componentes só chamam essas funções.

**Tech Stack:** Next.js 16 + React, TypeScript, Supabase self-hosted (sem migration neste plano), Playwright no portão (`scripts/e2e/fluxo-completo.mjs`).

**Spec:** pedidos no WhatsApp de 20–21/10/2026 (Ramon, áudio 20/10 17:57: "toda vez que ela lança, sai a pré-conta mesmo sem ela pedir"; Andrey 20/10 18:51: espaçamento dos cards e filtro por categoria/subcategoria nos mais e menos vendidos) e pedido do dono em 21/10 ("não faz sentido ter o botão em todos os acessos… como diferenciar de qual restaurante é").

## Global Constraints

- Branch de trabalho: `feat/login-multiloja` no worktree `/Users/joaquimsalles/Projects/norte para negocios/.worktrees/login-multiloja` (= origin/main 5a563b0). Não mexer no checkout `ntb vendas` (outra sessão, branch hotfix-impressao).
- Sem redesign: manter o visual atual (Button, Modal, `confirm()` de `components/ConfirmDialog.tsx`).
- Texto para o cliente em português e dizendo "Norte Vendas".
- Nada de teste no Sertão (4f8a9e1a-…); e2e roda na loja de teste do portão.
- Publicação: portão `caffeinate -dimsu bash scripts/e2e/portao-deploy.sh` → `deploy.sh` do site de madrugada, sem movimento; apps com `scripts/release-apps.sh`, atualização opcional.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_0183b5mkJcQaRjgHoMxzahgr`.

## Review Focus

1. Garçom que toca 2x rápido no "Confirmar pedido" (toque atravessa para o modal da mesa) → nenhuma conta pedida, nenhuma pré-conta. Teste em Task 1 (`podePedirConta` dentro da janela).
2. Computador do salão do Sertão que já usa "Mesas · Sem login" hoje → depois de atualizar continua abrindo o Sertão sem ninguém configurar nada. Teste em Task 2 (`migrarChaveAntiga`).
3. Ramon/Thaise (acesso a 2 lojas) entram na ODARA num PC do Sertão → o botão continua "Mesas · O Sertão Vai Virar Mar". Teste em Task 2 (login não grava mais a loja).
4. Loja sem grupo de categoria (só categorias soltas) e produto órfão (`category_id` null) → filtro mostra só categorias; produto órfão aparece em "Todas" e some nos filtros. Teste em Task 3.
5. Caixa (pode finalizar) não ganha o diálogo novo: o botão dele é "Receber e finalizar", não muda. Conferir na Task 1, passo e2e.

---

### Task 1: "Pedir conta" do garçom com confirmação e trava de toque

**Files:**
- Create: `lib/pedirConta.ts`
- Test: `scripts/testes/pedirConta.test.ts`
- Modify: `components/modules/StoreModule.tsx` — `handleRequestBill` (~4586), botões "Pedir conta" (~5595 e ~5868), efeito de `showMenuMode` (~3290)
- Modify: `scripts/e2e/fluxo-completo.mjs:654` (clicar no "Pedir conta" e depois confirmar)

**Interfaces:**
- Produces: `TRAVA_TOQUE_MS = 900`; `podePedirConta(agoraMs: number, cardapioFechouEmMs: number | null, travaMs?: number): boolean` — false enquanto `agoraMs - cardapioFechouEmMs < travaMs`; true se `cardapioFechouEmMs` é null.
- Produces: `textoConfirmarConta(mesa: number | string, saiPreConta: boolean): { title: string; message: string; confirmLabel: string }` — title `Pedir a conta da mesa ${mesa}?`, message `"A mesa fica como Pediu conta e só o caixa consegue reabrir."` + (saiPreConta ? `" A pré-conta sai na impressora."` : ''), confirmLabel `"Pedir conta"`.

- [ ] **Step 1: Teste que falha** — `scripts/testes/pedirConta.test.ts`: `podePedirConta(1000, 500)` → false; `podePedirConta(1500, 500)` → true; `podePedirConta(1000, null)` → true; `textoConfirmarConta(4, true).title === 'Pedir a conta da mesa 4?'` e `.message` termina em `A pré-conta sai na impressora.`; com `false` não contém "pré-conta".
- [ ] **Step 2: Rodar** `npx tsx scripts/testes/pedirConta.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar `lib/pedirConta.ts`** com as duas funções acima.
- [ ] **Step 4: Rodar de novo** → `pedirConta: ok`.
- [ ] **Step 5: Ligar no StoreModule** — `useRef<number | null>` `cardapioFechouEm` gravado com `Date.now()` quando `showMenuMode` passa de true para false (no efeito da linha ~3290). Em `handleRequestBill`: se `!podePedirConta(Date.now(), cardapioFechouEm.current)` retorna sem fazer nada; senão `await confirm(textoConfirmarConta(mesa.number, haImpressoraDePreConta))`; só com `true` segue o fluxo atual (requestTableBill + `printTableBill(tableId, true)`). `haImpressoraDePreConta` = a mesma condição que `printTableBill(…, true)` já usa para decidir se imprime.
- [ ] **Step 6: e2e** — em `fluxo-completo.mjs:654`, depois do clique em "Pedir conta" clicar no botão "Pedir conta" do diálogo (`getByRole('button', { name: 'Pedir conta', exact: true })` dentro do dialog). Conferir que o caixa continua sem diálogo (botão "Receber e finalizar").
- [ ] **Step 7: Commit** `fix(mesas): Pedir conta do garçom pede confirmação e ignora toque logo depois de confirmar o pedido (pré-conta sozinha na ODARA)`.

### Task 2: Computador de mesas preso a uma loja

**Files:**
- Create: `lib/computadorMesas.ts`
- Test: `scripts/testes/computadorMesas.test.ts`
- Create: `components/modules/ComputadorMesasCard.tsx`
- Modify: `components/modules/PrinterSettingsView.tsx` (renderiza o card acima do card "Este computador")
- Modify: `components/modules/StoreModule.tsx` — remover as 3 gravações de `MESAS_LOJA_STORAGE_KEY` em `handleLogin` (~14212, ~14221) e no efeito (~14229); `lojaMesas`/`entrarMesas` (~14224–14245) passam a ler `lerComputadorMesas()`; `StoreLogin` (~151) recebe o nome da loja e mostra `Mesas · {nome}` no botão redondo (~556) e `Entrar só nas mesas · {nome}` no formulário (~740)

**Interfaces:**
- Produces: `type ComputadorMesas = { storeId: string; storeName: string; definidoPor: string; em: string }` (em = ISO).
- Produces: `lerComputadorMesas(): ComputadorMesas | null` (chave `ntb-computador-mesas`), `salvarComputadorMesas(c: ComputadorMesas | null): void` (null apaga).
- Produces: `migrarChaveAntiga(nomeDaLoja: (id: string) => Promise<string | null>): Promise<ComputadorMesas | null>` — se não existe config nova e existe `ntb_mesas_loja`, cria a config com o nome buscado (`definidoPor: 'atualização'`) e apaga a chave antiga; se já existe config nova, só apaga a antiga e devolve a nova.
- Consumes: `fetchStoreById` (lib/api) como `nomeDaLoja`.

- [ ] **Step 1: Teste que falha** — com um `localStorage` falso em `globalThis`: salvar e ler devolve o mesmo objeto; `salvarComputadorMesas(null)` → `lerComputadorMesas() === null`; JSON quebrado → null; `migrarChaveAntiga` com `ntb_mesas_loja='s1'` e nome `'Sertão'` → `{storeId:'s1', storeName:'Sertão', definidoPor:'atualização'}` e a chave antiga some; com config nova de `'o1'` já salva e chave antiga `'s1'` → devolve `'o1'` (login antigo não sobrescreve); nome null (loja inativa) → null e nada salvo.
- [ ] **Step 2: Rodar** `npx tsx scripts/testes/computadorMesas.test.ts` → FAIL.
- [ ] **Step 3: Implementar `lib/computadorMesas.ts`.**
- [ ] **Step 4: Rodar de novo** → `computadorMesas: ok`.
- [ ] **Step 5: Card** `ComputadorMesasCard({ store, loggedUser })`: título "Tela de Mesas neste computador"; ligado mostra "Este computador abre as Mesas de {storeName}" + botão "Desligar"; desligado mostra botão "Usar este computador como Mesas da {store.name}". Ligar grava `{storeId: store.id, storeName: store.name, definidoPor: loggedUser.name, em}`. Se já está ligado para OUTRA loja, o botão diz "Trocar para {store.name}" e pede `confirm()`. Fica em Configurações > Impressão, que já é só de quem tem acesso a Configurações.
- [ ] **Step 6: StoreModule** — no mount, `await migrarChaveAntiga(id => fetchStoreById(id).then(s => s?.is_active ? s.name : null))`; `onEntrarMesas` só existe com config; `entrarMesas` usa `config.storeId`. Login de garçom continua abrindo as mesas da loja dele (não depende da config).
- [ ] **Step 7: e2e** — o portão usa o botão "Mesas"? `rg -n "Sem login|Entrar só nas mesas" scripts/e2e` — se usar, ligar a config na loja de teste antes (`localStorage` via `page.evaluate`) e mudar o seletor para o rótulo novo.
- [ ] **Step 8: Commit** `feat(mesas): botão Mesas sem login só no computador marcado e com o nome da loja; login não troca mais a loja das mesas`.

### Task 3: Ranking de produtos com filtro de categoria e espaçamento

**Files:**
- Create: `lib/rankingProdutos.ts`
- Test: `scripts/testes/rankingProdutos.test.ts`
- Modify: `components/modules/StoreDashboardView.tsx` — `productStats` (~359) passa a usar a função; `<select>` de categoria no topo dos cards "Top 5 mais/menos vendidos" (~768); `mt-4` na grade de "Mais cresceram/caíram" (~794)

**Interfaces:**
- Produces: `type FiltroCategoria = { tipo: 'todas' } | { tipo: 'grupo'; id: string } | { tipo: 'categoria'; id: string }`.
- Produces: `rankingDeProdutos(vendas: Order[], categorias: Category[], filtro: FiltroCategoria): { top: LinhaRanking[]; bottom: LinhaRanking[] }` com `LinhaRanking = { key: string; name: string; qty: number }` — mesmas regras de hoje (ignora cancelado e `fee_type`, chave `${product_id}::${assinatura}`, top 5, bottom 5 sem repetir o top); grupo = categorias com `group_id === id`.
- Produces: `opcoesDoFiltro(categorias: Category[], grupos: CategoryGroup[]): { value: string; label: string }[]` — `'todas'` primeiro ("Todas as categorias"); depois cada grupo (`g:<id>`, label do grupo) seguido das suas categorias (`c:<id>`, label `"  " + nome`); categorias soltas no fim. Ordem por `order`.
- Consumes: `fetchMenu(storeId, true)` dentro do StoreDashboardView para ter categorias e grupos (já devolve `categories, categoryGroups`). `order_items.product` da venda já traz `category_id` (RPC usa `to_jsonb(p)`).

- [ ] **Step 1: Teste que falha** — vendas falsas com 3 produtos em 2 categorias de 1 grupo + 1 produto órfão + 1 item cancelado + 1 taxa: `'todas'` igual ao cálculo antigo (órfão incluído, cancelado e taxa fora); `{tipo:'categoria', id:'c1'}` só produtos de c1; `{tipo:'grupo', id:'g1'}` soma c1+c2; órfão nunca aparece com filtro; `opcoesDoFiltro` sem grupos devolve só `todas` + categorias.
- [ ] **Step 2: Rodar** `npx tsx scripts/testes/rankingProdutos.test.ts` → FAIL.
- [ ] **Step 3: Implementar `lib/rankingProdutos.ts`** (mover a lógica de `productStats` para cá, sem mudar o resultado de `'todas'`).
- [ ] **Step 4: Rodar de novo** → `rankingProdutos: ok`; rodar também `npx tsx scripts/testes/comparativoProdutos.test.ts` (não pode quebrar).
- [ ] **Step 5: Tela** — `useState<string>('todas')`; `<select>` no estilo do filtro de impressão (`rounded-[var(--r-md)] border … max-sm:text-base`), rótulo "Categoria"; "Sem dados" quando o filtro esvazia. Grade de "Mais cresceram/caíram" ganha `mt-4`. Conferir no celular (largura 390) que os cards não encostam.
- [ ] **Step 6: Commit** `feat(relatorio): mais e menos vendidos com filtro por categoria e grupo; espaço entre os cards (pedido do Andrey)`.

### Task 4: Portão, publicação e aviso

- [ ] **Step 1:** rodar todos os `scripts/testes/*.test.ts` tocados + `npx tsc --noEmit` → sem erro.
- [ ] **Step 2:** subir versões (desktop/package.json +1, mobile/package.json +1, build.gradle versionCode/versionName), commit `chore: desktop X / android Y (pedir conta com confirmação, mesas por computador, ranking por categoria)`, push para origin/main.
- [ ] **Step 3:** fora do horário: `caffeinate -dimsu bash scripts/release-apps.sh` (roda o portão) → RELEASE OK; madrugada: conferir sem movimento, portão, `ssh … "bash /opt/ntb-vendas/deploy.sh"`, páginas 200.
- [ ] **Step 4:** texto para Ramon/Andrey mostrado ao dono; só envia com "manda".
