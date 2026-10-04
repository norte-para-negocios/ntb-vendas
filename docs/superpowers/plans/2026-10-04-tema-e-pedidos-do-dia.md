# Tema coerente e "Pedidos do Dia" refeito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Janelas e barras flutuantes deixam de ficar escuras em tela clara: só a preferência da pessoa (classe `.dark` no `<html>`) decide o tema. (B) "Pedidos do Dia" vira uma janela larga, organizada e legível (nome completo, colunas, agrupar por mesa/hora, filtros, resumo com falhas em destaque).

**Architecture:** (A) O `Modal variant="sheet"` e o `BottomSheet` do cardápio deixam de usar o "vidro escuro" (`u-glass-modal on-glass`, que força tokens escuros fixos) e passam a usar os tokens normais (`--surface`, `--text`, `--border`), com desfoque só no fundo (scrim). Um teste de "guarda" (`temaCoerente.test.ts`) lê os arquivos-fonte e falha se o vidro escuro voltar. (B) A lógica de filtro, busca, resumo e agrupamento vira `lib/pedidosDoDia.ts` (pura, testada); a tela vira `components/modules/PedidosDoDiaView.tsx`; `StoreModule.tsx` só monta a janela com `size="lg"`.

**Escopo:** correção de coerência + organização/legibilidade, sem redesign (ver Global Constraints).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4 (tokens via CSS custom properties), `motion/react`, testes `npx tsx scripts/testes/*.test.ts` + `node:assert/strict`, chrome-devtools MCP para a varredura visual.

**Spec:** conversa com o dono em 04/10/2026 (prints do "Pedidos do Dia" escuro numa tela clara e do cardápio digital do cliente): "essa entrada do pedido tem que ficar bem maior, mais organizada", "por que está no modo escuro se o negócio está no modo branco… tem que ser uma coisa convicta, só se a pessoa escolher escuro". Contexto: `AGENTS.md` (seção "Design system"), `docs/superpowers/plans/2026-10-04-mesa-cardapio-permissoes.md` (adendo, etapa 1).

## Achados do código (base do plano — conferidos, não supostos)

- `components/ui.tsx` — `Modal` tem 2 ramos. O ramo `variant="center"` (padrão) **já segue o tema**: `bg-[var(--surface)]`, `--shadow-modal` (ui.tsx ~linhas 450–500). O ramo `variant="sheet"` usa por padrão `surface = 'glass'` → classes `u-glass-modal on-glass` (ui.tsx:398) e textos `text-white`, `bg-white/10`, `border-white/10` (ui.tsx:408, 419, 427, 440).
- `app/globals.css:179` — `.on-glass` redefine `--text`, `--surface`, `--border`, `--brand`… com valores **escuros fixos**, qualquer que seja o tema. `.u-glass-modal` (globals.css:521) e `.u-glass-cart` (globals.css:511) são fundos `rgba(20,23,31,.85)`/`rgba(10,13,19,.72)`.
- **Correção do número do brief:** não são "37 de 39" janelas. São 39 `<Modal>` no total (30 em `StoreModule.tsx`, 6 em `ClientModule.tsx`, 2 em `AdminModule.tsx`, 1 em `CaixaPrintStation.tsx`), mas só as que usam **`variant="sheet"`** e `surface` glass ficam escuras: `StoreModule.tsx:957` (Falhas de sincronização), `:6026` (Pedidos do Dia), `:7697` (Histórico de Turnos), `CaixaPrintStation.tsx:1282`, `ClientModule.tsx:2318` (Conta da Mesa / BillSplitter). Mais 3 superfícies escuras próprias do cardápio do cliente: `BottomSheet` local (`ClientModule.tsx:1727–1880`, usado por `CartModal` "Seu Pedido" :1918 e "Acompanhar Pedido" :715), a barra flutuante "Sua Comanda" (`:4486`, `u-glass-cart on-glass`) e a pílula de status do pedido (`OrderStatusPill`, `:676–704`, fundo `--ink` fixo). Duas janelas já pediram `surface="opaque"` (`ClientModule.tsx:1380` ProductModal e `:4309` Categorias).
- Painel da equipe: todos os `text-white`/`bg-white/…` restantes em `StoreModule.tsx`, `AdminModule.tsx`, `StoreSettingsView.tsx`, `DesktopUpdateBanner.tsx`, `ThemeToggle.tsx` estão sobre fundo **de marca** (sidebar azul `.sidebar-blue`, telas de login, banners `--warn-fill`/`--info-fill`) — não são o problema e não mudam.
- "Pedidos do Dia": o botão só aparece quando `orderFlow === 'direct_print'` (`StoreModule.tsx:4676`, `resolveOrderFlow` em `lib/storeModules.ts:46` = `store.config.order_flow === 'direct_print'`); fora disso `sentHistoryItems` devolve `[]` (`:3430`). Dados: `sentHistoryItems` (`:3429–3480`) junta `activeOrders` + `closedTodayOrders` (`fetchSalesHistory` desde 00:00, `:3219–3228`). O estado de impressão hoje é **só** `printed: wasKitchenTicketPrinted(...)` (dedupe em `localStorage`, `CaixaPrintStation.tsx:484`): **não existe estado "falhou"** — o honesto é "Impresso" ou "Sem registro" (o próprio código documenta que não dá para provar um negativo). **Reimprimir já existe** e é preservado: botão só quando `!row.printed && !row.closed && canReprint` (`:6107–6117`, `handleManualReprint` `:3487`, `canReprint` `:2981`).
- Estado de UI do modal hoje vive em `TablesView`: `filtroLocal` (`:3124`) e `showOnlyMine` (`:3136`), usados só dentro do modal (`:6035–6075`).

## Global Constraints

- Português do Brasil na UI; sem `window.confirm`/`alert`; alvo de toque ≥ 44 px no celular (`max-sm:min-h-11`).
- **NÃO é redesign (restrição do dono, 04/10):** manter a identidade visual atual — tokens do `globals.css`, componentes de `components/ui.tsx` (`Button`, `Badge`, `Modal`, `Card`), cores, tipografia e raios (`--r-*`). Esta entrega só corrige a coerência de tema e melhora organização/legibilidade. Nenhum token, fonte ou componente novo; a tela nova usa só o que já existe.
- **Animação:** reaproveitar a linguagem existente — mola `SPRING_SHEET`/`SPRING_UI` do `Modal`, classes `u-motion`/`u-press`/`u-press-sm`, crossfade de 120 ms do admin. Curtas e sutis. Nada de animação nova: nenhuma entrada em cascata, nenhum `motion.div` novo na lista; respeitar `prefers-reduced-motion` (já tratado no CSS global). O desfoque do scrim da Task 1 é estático (sem transição extra).
- **Tema:** nenhum componente força cor própria. Janela e barra flutuante usam `--surface`, `--surface-2`, `--text`, `--text-muted`, `--border`, `--brand`/`--brand-fill`. Branco fixo só sobre fundo de marca/foto (botão `--brand-fill`, badge `--err-fill`, ícones sobre foto com `bg-black/35`).
- **Exceções de marca mantidas (decisão registrada, ver "Perguntas em aberto"):** cabeçalho/barras `--ink` do cardápio do cliente ("carta de vinhos", `ClientModule.tsx:4056`, `:4535`, card de total `:2479`) e a tela de entrada por PIN (`:931`, único uso restante de `u-glass-modal`).
- A API de `Modal` perde só a prop `surface` (os 2 chamadores com `"opaque"` são ajustados); `size`, `variant`, `hideTitle`, `phoneSheet` não mudam.
- **QA somente em loja de TESTE** (ZZ Laboratório `zz-laboratorio`, ou Donana). **NUNCA "O Sertão Vai Virar Mar"** (produção). Não emitir nota fiscal; apagar tudo que for criado (mesa/pedido/usuário QA); restaurar qualquer `config` alterada.
- **Sem deploy** neste plano. Só commits locais; deploy fica para quando a loja estiver fechada.
- Cada task termina com `npx tsc --noEmit` limpo, testes passando e commit. Mensagem de commit termina com as linhas de atribuição:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7`.

## Review Focus

1. **Contraste no tema escuro:** `--brand` (#8b90ea no escuro) como texto sobre `--surface` e botão cheio com `--brand-fill` + `text-white` (o botão em `ClientModule.tsx:1997` usa `--brand` com texto branco: fica fraco no escuro). Verificado na varredura (Task 6) com leitura de contraste e screenshot.
2. **Chamadores de `surface="opaque"`:** remover a prop quebra a compilação se sobrar algum uso — `tsc` + o teste de guarda pegam.
3. **"Meus pedidos" ligado e item sem `addedByName`** (pedido de QR/cliente) ou lista vazia / só mesas fechadas: tem que dar mensagem certa, nunca lista em branco (teste na lib + conferência visual).
4. **Nome de produto gigante e observação com várias linhas** não estouram a coluna nem empurram os badges para fora (`min-w-0` + `break-words`; conferência visual com item de 120+ caracteres).
5. **Mesa com número repetido/`'?'` e pedido entre 23h–01h:** o agrupamento por mesa usa a chave como texto; o agrupamento por hora usa o fuso America/Bahia (teste com 03:10Z = 00h).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `scripts/testes/temaCoerente.test.ts` (novo) | guarda: vidro escuro fixo não volta |
| `components/ui.tsx` (editar) | `Modal variant="sheet"` segue o tema; remove prop `surface` |
| `components/modules/ClientModule.tsx` (editar) | `BottomSheet`, barra "Sua Comanda", `OrderStatusPill`, botão do cupom, chamadores |
| `app/globals.css` (editar) | remove `.on-glass` e `.u-glass-cart` (sem uso) |
| `lib/pedidosDoDia.ts` (novo) | filtro, busca, resumo, agrupamento (puro) |
| `scripts/testes/pedidosDoDia.test.ts` (novo) | testes da lib |
| `components/modules/PedidosDoDiaView.tsx` (novo) | tela do "Pedidos do Dia" |
| `components/modules/StoreModule.tsx` (editar) | monta a janela larga; remove estado antigo |
| `AGENTS.md` (editar) | regra de tema na seção "Design system" |

---

### Task 1: Guarda de tema + `Modal variant="sheet"` segue o tema

**Files:**
- Create: `scripts/testes/temaCoerente.test.ts`
- Modify: `components/ui.tsx` (ramo `variant === 'sheet'`, ~linhas 187–192, 320–450), `components/modules/ClientModule.tsx:1380`, `:4309`

**Interfaces:**
- Produces: `Modal` sem prop `surface`; no ramo `sheet` o painel é `bg-[var(--surface)]` com tokens normais. O teste de guarda (Tasks 1–3) é a verificação central do tema.

- [ ] **Step 1: Escrever o teste de guarda (parte da `ui.tsx`)**

```ts
// rodar com: npx tsx scripts/testes/temaCoerente.test.ts   (na raiz do repo)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const conta = (txt: string, re: RegExp) => (txt.match(re) ?? []).length;

const ui = ler('components/ui.tsx');
const cli = ler('components/modules/ClientModule.tsx');

// Regra: só a preferência da pessoa (.dark no <html>) decide claro/escuro. O Modal nunca força tema.
assert.equal(conta(ui, /on-glass|u-glass-modal|u-glass-cart/g), 0, 'Modal (ui.tsx) não pode usar o vidro escuro fixo');
assert.equal(conta(ui, /surface\?: 'glass'/g), 0, 'a prop surface do Modal foi removida');
assert.equal(conta(ui, /bg-white\/|border-white\/|text-white\/60/g), 0, 'sem branco translúcido fixo dentro do Modal');
assert.equal(conta(cli, /surface="opaque"/g), 0, 'chamadores não passam mais surface="opaque"');

console.log('temaCoerente (ui.tsx): ok');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/testes/temaCoerente.test.ts`
Expected: FAIL — `Modal (ui.tsx) não pode usar o vidro escuro fixo`.

- [ ] **Step 3: Verificar que o token de sombra existe fora do `.dark`**

Run: `grep -n "shadow-modal" app/globals.css`
Expected: definido também em `:root` (o ramo `center` já o usa em tema claro). Se aparecer só dentro de `.dark`, acrescentar em `:root`: `--shadow-modal: 0 20px 60px -12px rgba(0,0,0,0.25), 0 0 0 1px var(--border);`.

- [ ] **Step 4: Editar `ui.tsx` — remover a prop `surface`**

Apagar o comentário `// 'opaque' (2026-08-21 ...` e a linha `surface?: 'glass' | 'opaque';` (ui.tsx ~187–192) e trocar a assinatura:

```tsx
}> = ({ isOpen, onClose, title, children, width, variant = 'center', hideTitle = false, size = 'sm', phoneSheet = true }) => {
```

- [ ] **Step 5: Editar `ui.tsx` — painel, alça, barra de título e botão do ramo `sheet`**

Scrim (só ganha desfoque; a cor de fundo continua):
```tsx
className="fixed inset-0 z-50 flex items-end sm:items-center justify-center backdrop-blur-sm"
```
Painel — substituir o `className` e o `style` (hoje com ternários `surface === 'opaque'`) por:
```tsx
className={`w-full ${resolvedWidth} rounded-t-[var(--r-xl)] sm:rounded-[var(--r-xl)] relative overflow-hidden u-sheet-h flex flex-col bg-[var(--surface)]`}
style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
```
Alça: `<div className="w-10 h-1 rounded-full bg-[var(--border)]" />`.
Barra de título (`className` do `div` quando `!hideTitle`): `flex items-center justify-between px-5 py-3 flex-shrink-0 border-b border-[var(--border)]`.
Título: `className={`text-[15px] font-semibold text-[var(--text)] ${hideTitle ? 'sr-only' : ''}`}`.
Botão fechar (ramo sem `hideTitle`):
```tsx
: 'p-1 rounded-[var(--r-sm)] u-motion text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
```
(o ramo `hideTitle` — `bg-black/40 text-white backdrop-blur-md` — fica: é um botão redondo sobre a foto do produto).

- [ ] **Step 6: Editar os dois chamadores**

`ClientModule.tsx:1380`: `<Modal isOpen={!!incomingProduct} onClose={onClose} title={product.name} variant="sheet" hideTitle>`
`ClientModule.tsx:4309`: `<Modal isOpen={showAllCategories} onClose={() => setShowAllCategories(false)} title="Categorias" variant="sheet">`

- [ ] **Step 7: Rodar e ver passar**

Run: `npx tsx scripts/testes/temaCoerente.test.ts && npx tsc --noEmit`
Expected: `temaCoerente (ui.tsx): ok`, `tsc` sem erros.

- [ ] **Step 8: Commit**

```bash
git add scripts/testes/temaCoerente.test.ts components/ui.tsx components/modules/ClientModule.tsx
git commit -m "fix(tema): janelas em folha (Pedidos do Dia, Histórico de Turnos, Conta da Mesa…) seguem o tema da pessoa, sem vidro escuro fixo

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7"
```

---

### Task 2: `BottomSheet` do cardápio do cliente (Seu Pedido, Acompanhar Pedido)

**Files:**
- Modify: `components/modules/ClientModule.tsx` (`BottomSheet` ~:1862–1871, botão do cupom :1997), `scripts/testes/temaCoerente.test.ts`

**Interfaces:**
- Consumes: regra de tema da Task 1.
- Produces: `BottomSheet` com painel `bg-[var(--surface)]`; `CartModal`/`OrderStatusModal` herdam os tokens do tema (seus textos já usavam `var(--text)`/`var(--text-muted)`, que só funcionavam por causa do `.on-glass`).

- [ ] **Step 1: Estender o teste de guarda**

Acrescentar antes do `console.log`:
```ts
// BottomSheet do cardápio: sem vidro escuro nem branco fixo
const ini = cli.indexOf('function BottomSheet(');
const fim = cli.indexOf('const CartModal');
assert.ok(ini > 0 && fim > ini, 'achou o BottomSheet no ClientModule');
const bottomSheet = cli.slice(ini, fim);
assert.equal(conta(bottomSheet, /on-glass|u-glass-modal/g), 0, 'BottomSheet não força tema');
assert.equal(conta(bottomSheet, /bg-white\/|border-white|rgba\(255,\s*255,\s*255/g), 0, 'BottomSheet sem branco translúcido fixo');
// Botão cheio com texto branco usa o token de preenchimento (contraste nos dois temas)
assert.equal(conta(cli, /bg-\[var\(--brand\)\] text-white/g), 0, 'botão cheio usa --brand-fill, não --brand');
```
Run: `npx tsx scripts/testes/temaCoerente.test.ts` → Expected: FAIL (`BottomSheet não força tema`).

- [ ] **Step 2: Editar o painel do `BottomSheet`**

```tsx
// ClientModule.tsx ~:1862 — className do motion.div "sheet"
className={`w-full ${maxWidth} rounded-t-[var(--r-xl)] sm:rounded-[var(--r-xl)] overflow-hidden flex flex-col max-h-[90vh] bg-[var(--surface)]`}
style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
```
Alça (~:1871): `<div className="w-10 h-1 rounded-full bg-[var(--border)]" />`.
Scrim do `BottomSheet` (~:1830): acrescentar `backdrop-blur-sm` à `className` (`fixed inset-0 z-50 flex items-end sm:items-center justify-center backdrop-blur-sm`).
Atualizar o comentário do bloco (~:1716–1726) para dizer que a folha segue o tema da pessoa.

- [ ] **Step 3: Botão do cupom (contraste)**

`ClientModule.tsx:1997`: trocar `bg-[var(--brand)] text-white` por `bg-[var(--brand-fill)] text-white` (mesmo token que o resto dos botões cheios; `--brand` no escuro é claro e o branco some).

- [ ] **Step 4: Rodar teste e tipos**

Run: `npx tsx scripts/testes/temaCoerente.test.ts && npx tsc --noEmit`
Expected: ok / sem erros.

- [ ] **Step 5: Commit**

```bash
git add components/modules/ClientModule.tsx scripts/testes/temaCoerente.test.ts
git commit -m "fix(tema): carrinho e acompanhamento do pedido do cliente seguem o tema (sem folha escura em tela clara)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7"
```

---

### Task 3: Barra flutuante "Sua Comanda", pílula de status e limpeza do CSS morto

**Files:**
- Modify: `components/modules/ClientModule.tsx` (`OrderStatusPill` :676–704; barra :4486–4510), `app/globals.css` (:179–195 `.on-glass`; :511–514 `.u-glass-cart`; `@media (prefers-reduced-transparency)` ~:527–535), `scripts/testes/temaCoerente.test.ts`

**Interfaces:** Consumes Tasks 1–2. Produces: nenhum uso de `on-glass`/`u-glass-cart` no código; `u-glass-modal` só no overlay da tela de entrada por PIN (`ClientModule.tsx:931`, exceção de marca).

- [ ] **Step 1: Estender o teste (falha primeiro)**

```ts
// Barras flutuantes e pílula: seguem o tema
assert.equal(conta(cli, /on-glass|u-glass-cart/g), 0, 'nenhum uso de on-glass/u-glass-cart no cardápio');
assert.equal(conta(cli, /u-glass-modal/g), 1, 'u-glass-modal só no overlay da tela de entrada (exceção de marca)');
const css = ler('app/globals.css');
assert.equal(conta(css, /^\.on-glass\s*\{/gm), 0, '.on-glass removido do CSS');
assert.equal(conta(css, /^\.u-glass-cart\s*\{/gm), 0, '.u-glass-cart removido do CSS');
```
Run → Expected: FAIL (`nenhum uso de on-glass/u-glass-cart…`).

- [ ] **Step 2: `OrderStatusPill` (ClientModule.tsx:683–701)**

```tsx
className={`w-full flex items-center gap-3 px-4 py-3 rounded-[var(--r-lg)] border text-left transition-transform active:scale-[0.98] ${
    isReady ? 'bg-[var(--ok)]/10 border-[var(--ok)]/30 animate-pulse' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'
}`}
style={isReady ? undefined : { boxShadow: 'var(--shadow-md)' }}
```
Textos: `isReady ? 'text-[var(--ok)]' : 'text-[var(--text)]'` no rótulo; `isReady ? 'text-[var(--ok)]/70' : 'text-[var(--text-muted)]'` na linha de apoio; `className={isReady ? 'text-[var(--ok)]' : 'text-[var(--text-muted)]'}` no chevron. O ícone (fundo `color-mix(--brand 15%)`, cor `var(--brand)`) fica como está.

- [ ] **Step 3: Barra "Sua Comanda" (ClientModule.tsx:4486–4505)**

```tsx
className="px-4 pt-3 pb-4 rounded-[var(--r-lg)] flex flex-col gap-3 border bg-[var(--surface)] text-[var(--text)]"
style={{ borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }}
```
Textos: `Sua Comanda` → `text-[13px] font-medium text-[var(--text)]`; contagem de itens → `text-[11px] text-[var(--text-muted)]`; total → `text-[18px] font-bold text-[var(--text)]`. **Reescrever o comentário** em volta do total (:4498–4503, que hoje justifica o branco "porque esta barra é um cartão de vidro ESCURO") para: "o total não é colorido (regra de promoção) — usa `--text`, que acompanha o tema".

- [ ] **Step 4: Apagar CSS sem uso**

Em `app/globals.css`: remover o bloco `.on-glass { … }` (com seu comentário, ~:170–195), o bloco `.u-glass-cart { … }` (~:511–514) e `.u-glass-cart,` da lista do `@media (prefers-reduced-transparency: reduce)`. Manter `.u-glass`, `.u-glass-bar`, `.u-glass-modal`.

- [ ] **Step 5: Verificar**

Run: `npx tsx scripts/testes/temaCoerente.test.ts && npx tsc --noEmit && grep -rn "on-glass\|u-glass-cart" app components | head`
Expected: teste ok, `tsc` limpo, `grep` sem resultados.

- [ ] **Step 6: Commit**

```bash
git add components/modules/ClientModule.tsx app/globals.css scripts/testes/temaCoerente.test.ts
git commit -m "fix(tema): barra da comanda e pílula de status do cliente seguem o tema; remove vidro escuro sem uso do CSS

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7"
```

---

### Task 4: Lógica pura de "Pedidos do Dia" (`lib/pedidosDoDia.ts`)

**Files:**
- Create: `lib/pedidosDoDia.ts`, `scripts/testes/pedidosDoDia.test.ts`

**Interfaces:**
- Produces (usados pela Task 5):
  - `interface LinhaPedido { id: string; orderId: string; time: string; tableNumber: number | string; productName: string; quantity: number; destination: 'kitchen' | 'bar'; localId: string; addons?: string; observation?: string; client?: string | null; closed: boolean; printed: boolean; addedByName?: string | null }` (estruturalmente igual às linhas de `sentHistoryItems`)
  - `type EstadoFiltro = 'todos' | 'impresso' | 'sem_registro'`
  - `interface Filtros { local: string; estado: EstadoFiltro; busca: string; soMeus: boolean; meuNome: string }`; `const FILTROS_PADRAO: Filtros`
  - `filtrarLinhas(rows, f, ignorarLocal?: boolean): LinhaPedido[]`; `buscaCombina(l, busca): boolean`; `contarPorLocal(rows, f): Record<string, number>` (chave `'todos'` + um por `localId`)
  - `resumir(rows): { linhas: number; unidades: number; impressos: number; semRegistro: number; semRegistroAbertas: number; mesas: number }`
  - `interface GrupoPedidos { chave: string; titulo: string; linhas: LinhaPedido[]; unidades: number; semRegistro: number; semRegistroAbertas: number; ultimaHora: string; fechada: boolean }`; `agruparPorMesa(rows)`, `agruparPorHora(rows)`; `horaCurta(iso): string`

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/pedidosDoDia.test.ts
import assert from 'node:assert/strict';
import { filtrarLinhas, buscaCombina, contarPorLocal, resumir, agruparPorMesa, agruparPorHora, horaCurta, FILTROS_PADRAO, type LinhaPedido } from '../../lib/pedidosDoDia';

const L = (id: string, extra: Partial<LinhaPedido> = {}): LinhaPedido => ({
  id, orderId: `o-${id}`, time: '2026-10-04T22:10:00Z', tableNumber: 26, productName: 'Amstel 600ml', quantity: 1,
  destination: 'bar', localId: 'bar', closed: false, printed: true, addedByName: 'ANE', ...extra,
});

const rows: LinhaPedido[] = [
  L('1', { time: '2026-10-04T22:49:00Z', tableNumber: 290 }),
  L('2', { time: '2026-10-04T22:37:00Z', tableNumber: 306, productName: 'Pizza Meio a Meio (qualquer sabor)', addons: 'Grande, Portuguesa', localId: 'pizzaria', destination: 'kitchen', printed: false, addedByName: 'CLAUDIA' }),
  L('3', { time: '2026-10-04T22:37:30Z', tableNumber: 306, productName: 'Embalagem Pizza 40 cm', observation: 'viagem', localId: 'pizzaria', destination: 'kitchen', printed: false, addedByName: 'CLAUDIA' }),
  L('4', { time: '2026-10-04T22:12:00Z', tableNumber: 304, quantity: 2, productName: 'Refrigerante 350ml (Coca-Cola)', closed: true, printed: false, addedByName: null }), // fechada, sem nome (cliente/QR)
  L('5', { time: '2026-10-05T03:10:00Z', tableNumber: '?', productName: 'Água 350ml' }),                                              // 00h em Bahia
];
const f = (e: Partial<typeof FILTROS_PADRAO> = {}) => ({ ...FILTROS_PADRAO, ...e });

// hora em Bahia (UTC-3)
assert.equal(horaCurta('2026-10-04T22:10:00Z'), '19:10');

// busca: mesa, produto com acento, observação, quem lançou
assert.equal(buscaCombina(rows[0], 'mesa 290'), true);
assert.equal(buscaCombina(rows[1], 'portuguesa'), true);
assert.equal(buscaCombina(rows[3], 'agua'), false);
assert.equal(buscaCombina(rows[4], 'ÁGUA'), true, 'ignora acento e caixa');
assert.equal(buscaCombina(rows[2], 'viagem embalagem'), true, 'todas as palavras, qualquer ordem');
assert.equal(buscaCombina(rows[0], ''), true);

// filtros
assert.equal(filtrarLinhas(rows, f()).length, 5);
assert.deepEqual(filtrarLinhas(rows, f({ local: 'pizzaria' })).map((r) => r.id), ['2', '3']);
assert.deepEqual(filtrarLinhas(rows, f({ estado: 'sem_registro' })).map((r) => r.id), ['2', '3', '4']);
assert.deepEqual(filtrarLinhas(rows, f({ estado: 'impresso' })).map((r) => r.id), ['1', '5']);
assert.deepEqual(filtrarLinhas(rows, f({ soMeus: true, meuNome: 'CLAUDIA' })).map((r) => r.id), ['2', '3']);
assert.deepEqual(filtrarLinhas(rows, f({ soMeus: true, meuNome: 'ANE' })).map((r) => r.id), ['1', '5'], 'Review Focus 3: item sem nome nunca é "meu"');
assert.deepEqual(filtrarLinhas(rows, f({ soMeus: true, meuNome: 'NINGUEM' })), []);

// contagem por local ignora o filtro de local (chips mostram quanto tem em cada um)
assert.deepEqual(contarPorLocal(rows, f({ local: 'pizzaria' })), { todos: 5, bar: 3, pizzaria: 2 });

// resumo: falhas em destaque = sem registro de mesa ainda aberta
assert.deepEqual(resumir(rows), { linhas: 5, unidades: 6, impressos: 2, semRegistro: 3, semRegistroAbertas: 2, mesas: 4 });
assert.deepEqual(resumir([]), { linhas: 0, unidades: 0, impressos: 0, semRegistro: 0, semRegistroAbertas: 0, mesas: 0 });

// agrupar por mesa: grupo mais recente primeiro; dentro do grupo, na ordem em que foi lançado
const porMesa = agruparPorMesa(rows);
assert.deepEqual(porMesa.map((g) => g.titulo), ['Mesa ?', 'Mesa 290', 'Mesa 306', 'Mesa 304'], 'Review Focus 5: número "?" vira grupo próprio');
const m306 = porMesa.find((g) => g.chave === '306')!;
assert.deepEqual(m306.linhas.map((r) => r.id), ['2', '3']);
assert.equal(m306.unidades, 2);
assert.equal(m306.semRegistroAbertas, 2);
assert.equal(m306.fechada, false);
assert.equal(porMesa.find((g) => g.chave === '304')!.fechada, true);

// agrupar por hora (Bahia): 03:10Z = 00h do dia seguinte; mais recente primeiro
const porHora = agruparPorHora(rows);
assert.deepEqual(porHora.map((g) => g.chave), ['00', '19'], 'Review Focus 5: meia-noite é "00", não "24"; grupo mais recente primeiro');
assert.deepEqual(porHora.map((g) => g.titulo), ['00h', '19h']);
assert.equal(porHora.find((g) => g.chave === '19')!.linhas.length, 4);
assert.equal(porHora.find((g) => g.chave === '00')!.linhas[0].id, '5');

console.log('pedidosDoDia: ok');
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx scripts/testes/pedidosDoDia.test.ts` → `Cannot find module '../../lib/pedidosDoDia'`.

- [ ] **Step 3: Implementação**

```ts
// lib/pedidosDoDia.ts — lógica pura da janela "Pedidos do Dia" (sem React, sem I/O).
import { localDayAndMinutes } from './priceSchedule';

export interface LinhaPedido {
  id: string; orderId: string; time: string; tableNumber: number | string;
  productName: string; quantity: number; destination: 'kitchen' | 'bar'; localId: string;
  addons?: string; observation?: string; client?: string | null;
  closed: boolean; printed: boolean; addedByName?: string | null;
}
export type EstadoFiltro = 'todos' | 'impresso' | 'sem_registro';
export interface Filtros { local: string; estado: EstadoFiltro; busca: string; soMeus: boolean; meuNome: string }
export const FILTROS_PADRAO: Filtros = { local: 'todos', estado: 'todos', busca: '', soMeus: false, meuNome: '' };

const TZ = 'America/Bahia';
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const horaCurta = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export function buscaCombina(l: LinhaPedido, busca: string): boolean {
  const q = norm(busca);
  if (!q) return true;
  const alvo = [`mesa ${l.tableNumber}`, l.productName, l.addons, l.observation, l.client, l.addedByName]
    .filter(Boolean).map((x) => norm(String(x))).join(' | ');
  return q.split(/\s+/).every((p) => alvo.includes(p));
}

export function filtrarLinhas(rows: LinhaPedido[], f: Filtros, ignorarLocal = false): LinhaPedido[] {
  return rows.filter((l) =>
    (ignorarLocal || f.local === 'todos' || l.localId === f.local)
    && (!f.soMeus || (!!l.addedByName && l.addedByName === f.meuNome))
    && (f.estado === 'todos' || (f.estado === 'impresso') === l.printed)
    && buscaCombina(l, f.busca));
}

export function contarPorLocal(rows: LinhaPedido[], f: Filtros): Record<string, number> {
  const base = filtrarLinhas(rows, f, true);
  const out: Record<string, number> = { todos: base.length };
  base.forEach((l) => { out[l.localId] = (out[l.localId] ?? 0) + 1; });
  return out;
}

export function resumir(rows: LinhaPedido[]) {
  const semRegistro = rows.filter((l) => !l.printed);
  return {
    linhas: rows.length,
    unidades: rows.reduce((s, l) => s + l.quantity, 0),
    impressos: rows.length - semRegistro.length,
    semRegistro: semRegistro.length,
    semRegistroAbertas: semRegistro.filter((l) => !l.closed).length, // só estas podem ser reimpressas / exigem atenção
    mesas: new Set(rows.map((l) => String(l.tableNumber))).size,
  };
}

export interface GrupoPedidos {
  chave: string; titulo: string; linhas: LinhaPedido[]; unidades: number;
  semRegistro: number; semRegistroAbertas: number; ultimaHora: string; fechada: boolean;
}

const montarGrupo = (chave: string, titulo: string, linhas: LinhaPedido[]): GrupoPedidos => {
  const r = resumir(linhas);
  return {
    chave, titulo, linhas, unidades: r.unidades, semRegistro: r.semRegistro, semRegistroAbertas: r.semRegistroAbertas,
    ultimaHora: linhas.reduce((m, l) => (l.time > m ? l.time : m), linhas[0].time),
    fechada: linhas.every((l) => l.closed),
  };
};
const porUltimaHoraDesc = (a: GrupoPedidos, b: GrupoPedidos) => new Date(b.ultimaHora).getTime() - new Date(a.ultimaHora).getTime();
const agrupar = (rows: LinhaPedido[], chaveDe: (l: LinhaPedido) => string): Map<string, LinhaPedido[]> => {
  const m = new Map<string, LinhaPedido[]>();
  rows.forEach((l) => m.set(chaveDe(l), [...(m.get(chaveDe(l)) ?? []), l]));
  return m;
};

/** Um grupo por mesa; grupo mais recente primeiro; dentro dele, na ordem em que foi lançado (como uma comanda). */
export function agruparPorMesa(rows: LinhaPedido[]): GrupoPedidos[] {
  return Array.from(agrupar(rows, (l) => String(l.tableNumber)).entries())
    .map(([chave, ls]) => montarGrupo(chave, `Mesa ${chave}`, [...ls].sort((a, b) => a.time.localeCompare(b.time))))
    .sort(porUltimaHoraDesc);
}

/** Um grupo por hora cheia (fuso Bahia); mais recente primeiro; dentro dele, o item mais novo no topo. */
export function agruparPorHora(rows: LinhaPedido[]): GrupoPedidos[] {
  const hora = (l: LinhaPedido) => String(Math.floor(localDayAndMinutes(new Date(l.time), TZ).minutes / 60)).padStart(2, '0');
  return Array.from(agrupar(rows, hora).entries())
    .map(([chave, ls]) => montarGrupo(chave, `${chave}h`, [...ls].sort((a, b) => b.time.localeCompare(a.time))))
    .sort(porUltimaHoraDesc);
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx tsx scripts/testes/pedidosDoDia.test.ts && npx tsc --noEmit` → `pedidosDoDia: ok`.

- [ ] **Step 5: Commit**

```bash
git add lib/pedidosDoDia.ts scripts/testes/pedidosDoDia.test.ts
git commit -m "feat(pedidos-do-dia): lógica de filtro, busca, resumo e agrupamento por mesa/hora (pura, testada)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7"
```

---

### Task 5: Tela nova e janela larga ("Pedidos do Dia")

**Files:**
- Create: `components/modules/PedidosDoDiaView.tsx`
- Modify: `components/modules/StoreModule.tsx` (modal ~:6019–6139; estado antigo `:3124`, `:3136`; imports)

**Interfaces:**
- Consumes: tudo de `lib/pedidosDoDia.ts` (Task 4); `Badge`, `Button` de `@/components/ui`.
- Produces: `PedidosDoDiaView` com props `{ linhas: LinhaPedido[]; locais: { id: string; nome: string }[]; meuNome: string; soMeusInicial: boolean; podeReimprimir: boolean; reimprimindo: Set<string>; onReimprimir: (l: LinhaPedido) => void }`.

- [ ] **Step 1: Criar `PedidosDoDiaView.tsx`**

```tsx
'use client';
// "Pedidos do Dia": janela larga e organizada. Só visualização — a única ação é Reimprimir
// (itens sem registro de impressão em mesa ainda aberta, só no aparelho de caixa; decidido pelo chamador).
import React, { useMemo, useState } from 'react';
import { RotateCcw, Search, TriangleAlert } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import {
  FILTROS_PADRAO, agruparPorHora, agruparPorMesa, contarPorLocal, filtrarLinhas, horaCurta, resumir,
  type EstadoFiltro, type Filtros, type LinhaPedido,
} from '@/lib/pedidosDoDia';

export interface LocalOpcao { id: string; nome: string }
interface Props {
  linhas: LinhaPedido[];
  locais: LocalOpcao[];
  meuNome: string;
  soMeusInicial: boolean;
  podeReimprimir: boolean;
  reimprimindo: Set<string>;
  onReimprimir: (l: LinhaPedido) => void;
}

const Seg: React.FC<{ rotulo: string; valor: string; opcoes: { id: string; nome: string }[]; onChange: (id: string) => void }> = ({ rotulo, valor, opcoes, onChange }) => (
  <div role="group" aria-label={rotulo} className="flex p-1 bg-[var(--surface-2)] rounded-[var(--r-md)]">
    {opcoes.map((o) => (
      <button
        key={o.id}
        type="button"
        aria-pressed={valor === o.id}
        onClick={() => onChange(o.id)}
        className={`flex-1 min-h-9 max-sm:min-h-11 px-3 text-[13px] font-semibold rounded-[var(--r-sm)] whitespace-nowrap u-motion u-press-sm ${valor === o.id ? 'bg-[var(--surface)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]'}`}
      >
        {o.nome}
      </button>
    ))}
  </div>
);

const Tile: React.FC<{ rotulo: string; valor: number; destaque?: boolean; onClick?: () => void }> = ({ rotulo, valor, destaque, onClick }) => {
  const cls = `text-left rounded-[var(--r-md)] border px-4 py-3 ${destaque ? 'border-[var(--warn)]/40 bg-[var(--warn)]/10' : 'border-[var(--border)] bg-[var(--surface-2)]'}`;
  const inner = (
    <>
      <p className="text-[12px] text-[var(--text-muted)] flex items-center gap-1">{destaque && <TriangleAlert size={12} className="text-[var(--warn)]" />}{rotulo}</p>
      <p className={`text-[22px] font-semibold num leading-tight ${destaque ? 'text-[var(--warn)]' : 'text-[var(--text)]'}`}>{valor}</p>
    </>
  );
  return onClick ? <button type="button" onClick={onClick} className={`${cls} u-press-sm max-sm:min-h-11`}>{inner}</button> : <div className={cls}>{inner}</div>;
};

const corDoLocal = (id: string) =>
  id === 'bar' ? 'bg-[var(--info)]/10 text-[var(--info)]' : id === 'kitchen' ? 'bg-[var(--warn)]/10 text-[var(--warn)]' : 'bg-[var(--brand)]/10 text-[var(--brand)]';

const Linha: React.FC<{ l: LinhaPedido; localNome: string; mostrarMesa: boolean; podeReimprimir: boolean; reimprimindo: boolean; onReimprimir: () => void }> = ({ l, localNome, mostrarMesa, podeReimprimir, reimprimindo, onReimprimir }) => {
  const quem = l.addedByName ?? 'Cliente / QR';
  return (
    <div className="grid items-start gap-x-4 gap-y-1 px-3 py-3 border-b border-[var(--border)] last:border-b-0 grid-cols-[48px_minmax(0,1fr)] sm:grid-cols-[56px_minmax(0,1fr)_150px_110px_200px]">
      <span className="num text-[13px] text-[var(--text-muted)] pt-0.5">{horaCurta(l.time)}</span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-[var(--text)] break-words"><span className="num">{l.quantity}×</span> {l.productName}</p>
        {l.addons && <p className="text-[13px] text-[var(--text-muted)] break-words">{l.addons}</p>}
        {l.observation && <p className="text-[13px] font-semibold text-[var(--warn)] break-words whitespace-pre-line">Obs: {l.observation}</p>}
        {l.client && <p className="text-[12px] text-[var(--text-muted)] break-words">Cliente: {l.client}</p>}
        {mostrarMesa && <p className="text-[12px] text-[var(--text-muted)]">Mesa {l.tableNumber}{l.closed ? ' · fechada' : ''}</p>}
      </div>
      <span className="max-sm:hidden text-[13px] text-[var(--text-muted)] break-words pt-0.5">{quem}</span>
      <span className="max-sm:hidden"><Badge color={corDoLocal(l.localId)}>{localNome}</Badge></span>
      <div className="max-sm:col-start-2 flex flex-wrap items-center gap-1.5 sm:justify-end">
        <span className="sm:hidden text-[12px] text-[var(--text-muted)]">{quem}</span>
        <span className="sm:hidden"><Badge color={corDoLocal(l.localId)}>{localNome}</Badge></span>
        {l.printed ? <Badge variant="success">Impresso</Badge> : l.closed ? <Badge>Sem registro</Badge> : <Badge variant="warning">Sem registro</Badge>}
        {!l.printed && !l.closed && podeReimprimir && (
          <Button size="sm" variant="secondary" disabled={reimprimindo} onClick={onReimprimir}>
            <RotateCcw size={14} className="mr-1" /> Reimprimir
          </Button>
        )}
      </div>
    </div>
  );
};

export const PedidosDoDiaView: React.FC<Props> = ({ linhas, locais, meuNome, soMeusInicial, podeReimprimir, reimprimindo, onReimprimir }) => {
  const [filtros, setFiltros] = useState<Filtros>({ ...FILTROS_PADRAO, soMeus: soMeusInicial, meuNome });
  const [agrupar, setAgrupar] = useState<'mesa' | 'hora'>('mesa');
  const set = (p: Partial<Filtros>) => setFiltros((f) => ({ ...f, ...p }));

  const visiveis = useMemo(() => filtrarLinhas(linhas, filtros), [linhas, filtros]);
  const resumo = useMemo(() => resumir(visiveis), [visiveis]);
  const porLocal = useMemo(() => contarPorLocal(linhas, filtros), [linhas, filtros]);
  const grupos = useMemo(() => (agrupar === 'mesa' ? agruparPorMesa(visiveis) : agruparPorHora(visiveis)), [visiveis, agrupar]);
  const nomeDoLocal = (id: string) => locais.find((x) => x.id === id)?.nome ?? 'Cozinha';
  const chips: LocalOpcao[] = [{ id: 'todos', nome: 'Todos os locais' }, ...locais];

  return (
    <div className="space-y-4">
      {/* Controles ficam à vista enquanto a lista rola */}
      <div className="sticky top-0 z-10 -mx-5 -mt-5 px-5 pt-5 pb-3 bg-[var(--surface)] space-y-3 border-b border-[var(--border)]">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile rotulo="Itens lançados" valor={resumo.unidades} />
          <Tile rotulo="Impressos" valor={resumo.impressos} />
          <Tile
            rotulo="Sem registro (mesas abertas)"
            valor={resumo.semRegistroAbertas}
            destaque={resumo.semRegistroAbertas > 0}
            onClick={resumo.semRegistroAbertas > 0 ? () => set({ estado: 'sem_registro' }) : undefined}
          />
          <Tile rotulo="Mesas" valor={resumo.mesas} />
        </div>
        <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
          <label className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            <input
              type="search"
              value={filtros.busca}
              onChange={(e) => set({ busca: e.target.value })}
              placeholder="Buscar mesa, produto ou garçom"
              aria-label="Buscar pedidos"
              className="w-full h-10 max-sm:h-11 pl-9 pr-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)] text-[14px] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--brand)]"
            />
          </label>
          <Seg rotulo="Quais pedidos" valor={filtros.soMeus ? 'meus' : 'todos'} opcoes={[{ id: 'meus', nome: 'Meus pedidos' }, { id: 'todos', nome: 'Todos' }]} onChange={(v) => set({ soMeus: v === 'meus' })} />
          <Seg rotulo="Agrupar por" valor={agrupar} opcoes={[{ id: 'mesa', nome: 'Por mesa' }, { id: 'hora', nome: 'Por hora' }]} onChange={(v) => setAgrupar(v as 'mesa' | 'hora')} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={filtros.local === c.id}
                onClick={() => set({ local: c.id })}
                className={`shrink-0 min-h-9 max-sm:min-h-11 px-3 rounded-full text-[13px] font-semibold border u-motion ${filtros.local === c.id ? 'bg-[var(--brand-fill)] text-white border-[var(--brand)]' : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]'}`}
              >
                {c.nome} <span className="opacity-70 num">({porLocal[c.id] ?? 0})</span>
              </button>
            ))}
          </div>
          <div className="sm:ml-auto w-full sm:w-auto">
            <Seg
              rotulo="Estado da impressão"
              valor={filtros.estado}
              opcoes={[{ id: 'todos', nome: 'Todos' }, { id: 'impresso', nome: 'Impressos' }, { id: 'sem_registro', nome: 'Sem registro' }]}
              onChange={(v) => set({ estado: v as EstadoFiltro })}
            />
          </div>
        </div>
      </div>

      {visiveis.length === 0 ? (
        <div className="text-center py-10 space-y-3">
          <p className="text-[15px] text-[var(--text-muted)]">
            {linhas.length === 0
              ? 'Nenhum pedido lançado ainda hoje.'
              : filtros.soMeus && filtrarLinhas(linhas, { ...filtros, soMeus: false }).length > 0
                ? 'Nada lançado por você com esses filtros. Toque em "Todos" para ver os pedidos da equipe.'
                : 'Nenhum item com esses filtros.'}
          </p>
          {linhas.length > 0 && <Button size="sm" variant="secondary" onClick={() => setFiltros({ ...FILTROS_PADRAO, meuNome })}>Limpar filtros</Button>}
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => (
            <section key={g.chave} className="rounded-[var(--r-md)] border border-[var(--border)] overflow-hidden">
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)]">
                <h4 className="text-[15px] font-semibold text-[var(--text)]">{g.titulo}</h4>
                <span className="text-[13px] text-[var(--text-muted)] num">{g.unidades} {g.unidades === 1 ? 'item' : 'itens'} · último às {horaCurta(g.ultimaHora)}</span>
                {g.fechada && agrupar === 'mesa' && <Badge>Mesa fechada</Badge>}
                {g.semRegistroAbertas > 0 && <Badge variant="warning">{g.semRegistroAbertas} sem registro</Badge>}
              </header>
              <div className="hidden sm:grid grid-cols-[56px_minmax(0,1fr)_150px_110px_200px] gap-x-4 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border)]">
                <span>Hora</span><span>Item</span><span>Lançado por</span><span>Local</span><span className="text-right">Impressão</span>
              </div>
              {g.linhas.map((l) => (
                <Linha
                  key={l.id}
                  l={l}
                  localNome={nomeDoLocal(l.localId)}
                  mostrarMesa={agrupar === 'hora'}
                  podeReimprimir={podeReimprimir}
                  reimprimindo={reimprimindo.has(l.id)}
                  onReimprimir={() => onReimprimir(l)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Trocar o conteúdo da janela em `StoreModule.tsx`**

Localizar os limites: `grep -n "isOpen={showSentHistory}" components/modules/StoreModule.tsx` e o `</Modal>` que fecha esse bloco (hoje ~:6026 até ~:6139, logo antes do comentário "Subprojeto 3 (2026-08-25): trocar responsável…"). Substituir **o bloco inteiro do `<Modal>`** (e o comentário "Pedidos do Dia (redesign 2026-08-23…)" acima dele) por:

```tsx
{/* "Pedidos do Dia" (redesign 04/10/2026): janela larga; lógica em lib/pedidosDoDia.ts, tela em
    PedidosDoDiaView. Só visualização, exceto Reimprimir (item sem registro, mesa aberta, aparelho de
    caixa — `canReprint`). Cobre o dia inteiro, mesas fechadas incluídas — ver sentHistoryItems. */}
<Modal isOpen={showSentHistory} onClose={() => setShowSentHistory(false)} title="Pedidos do Dia" variant="sheet" size="lg">
    <PedidosDoDiaView
        linhas={sentHistoryItems}
        locais={[{ id: 'kitchen', nome: 'Cozinha' }, { id: 'bar', nome: 'Bar' }, ...locaisInfo.setores.map(x => ({ id: x.id, nome: x.name }))]}
        meuNome={loggedUser.name}
        soMeusInicial={loggedUser.role === 'waiter'}
        podeReimprimir={canReprint}
        reimprimindo={reprintingIds}
        onReimprimir={handleManualReprint}
    />
</Modal>
```
Acrescentar o import: `import { PedidosDoDiaView } from './PedidosDoDiaView';` (junto de `import { FloorPlanView } from './FloorPlanView';`).

- [ ] **Step 3: Remover o estado que ficou sem uso**

Conferir: `grep -n "filtroLocal\|setFiltroLocal\|showOnlyMine\|setShowOnlyMine" components/modules/StoreModule.tsx` — devem sobrar só as declarações (`:3124`, `:3136`). Apagar as duas linhas de `useState` e o comentário "Subprojeto 3 (2026-08-25) — 'Meus pedidos do dia'…" acima de `showOnlyMine`. Rodar `npx eslint components/modules/StoreModule.tsx components/modules/PedidosDoDiaView.tsx` e remover imports que ficarem sem uso (`RotateCcw`, `Badge`, se só eram usados no modal antigo — conferir antes com `grep -c`).

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && for t in scripts/testes/*.test.ts; do npx tsx "$t" || echo "FALHOU $t"; done`
Expected: `tsc` limpo, nenhum `FALHOU`.

- [ ] **Step 5: Commit**

```bash
git add components/modules/PedidosDoDiaView.tsx components/modules/StoreModule.tsx
git commit -m "feat(pedidos-do-dia): janela larga com colunas, nome completo, agrupar por mesa/hora, filtros e resumo com falhas em destaque

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7"
```

---

### Task 6: Varredura visual nos dois temas (computador e celular) + documentação

**Files:**
- Modify: `AGENTS.md` (seção "Design system"), e o que a varredura achar (cada correção com commit próprio)
- Capturas: salvas na pasta de scratch da sessão (`/private/tmp/claude-501/-Users-joaquimsalles/c6bc8184-59d3-420a-a93b-f78ddbc44bd9/scratchpad/`), **não** no repositório

**Regras de segurança (valem para todos os passos):** só a loja ZZ Laboratório (ou Donana). Nunca o Sertão. Conferir antes de qualquer ação (`list_pages` + título/URL + nome da loja na sidebar) — o navegador do chrome-devtools é persistente e pode estar logado como o usuário real. Não emitir nota fiscal. Tudo o que for criado é apagado no fim; `config` alterada é restaurada.

- [ ] **Step 1: Subir o app local apontando para loja de teste**

Run: `DISABLE_FISCAL_RETRANSMISSAO=1 npm run dev` (porta 3000; o dev local usa o banco de produção — por isso só mexer na ZZ). Abrir `http://localhost:3000/loja` e entrar na ZZ Laboratório com um usuário QA temporário (criar em Administração → Usuários; senha de teste só nesse host local).

- [ ] **Step 2: Preparar os dados de teste na ZZ**

(a) Ligar "pedido direto" só para ver "Pedidos do Dia": a ZZ precisa de `config.order_flow = 'direct_print'` (a Donana é `kds` e o botão nem aparece). Anotar o valor antigo de `config` antes; restaurar no Step 8. (b) Mesa de teste (ex.: 900) com 3–4 itens lançados: um produto com nome longo (120+ caracteres), um com adicionais e observação de 3 linhas, uma pizza do local "Pizzaria" se existir, e uma mesa fechada hoje. (c) Itens sem registro de impressão (basta não ter o Caixa imprimindo nesse aparelho).

- [ ] **Step 3: Capturar "Pedidos do Dia" — 4 combinações**

Para cada combinação — claro/computador (1440×900), claro/celular (390×844), escuro/computador, escuro/celular — usar `resize_page`/`emulate` (viewport) e alternar o tema pelo botão da lua (ou `localStorage.setItem('theme','dark'|'light')` + recarregar). `take_screenshot` com a janela aberta (Mesas → "Pedidos do Dia"). Conferir, em cada uma: fundo da janela claro no tema claro e escuro no tema escuro; nome do item inteiro sem "…"; colunas alinhadas; resumo no topo com o "Sem registro" em laranja; busca, "Meus/Todos", "Por mesa/Por hora", chips de local e filtro de estado visíveis e tocáveis (44 px no celular); agrupamento por hora com mesa na linha do item; grupo "00h" depois da meia-noite.

- [ ] **Step 3b: Conferir que a identidade e o movimento não mudaram**

Comparar com a captura de referência de antes das mudanças (tirar uma do `main` atual da ZZ na Step 2, nos dois temas): mesmos tokens de cor, tipografia, raios e sombras; botões e badges são os do `ui.tsx`. Movimento: a janela abre e fecha com a mesma mola de antes (sheet sobe no celular, `scale` no computador), botões com o mesmo `u-press`, troca de aba do admin com o crossfade de 120 ms; a lista nova não anima entrada. Se algo ficar com cara diferente do resto do app, ajustar para o componente/token existente em vez de criar estilo novo.

- [ ] **Step 4: Medir contraste (Review Focus 1)**

No tema escuro, com `evaluate_script`, ler cor do texto e do fundo de: título do grupo, badge "Impresso", chip ativo (`--brand-fill` + branco), botão do cupom (Task 2). Registrar a razão de contraste de cada um (mínimo 4.5:1 para texto normal). Corrigir token/classe se ficar abaixo.

- [ ] **Step 5: Capturar o cardápio do cliente (ZZ, mesa de teste com PIN)**

Abrir `/c/zz-laboratorio`, entrar na mesa de teste (PIN), adicionar 2 itens (não confirmar o pedido): capturar nos 4 modos (claro/escuro × computador/celular): janela do produto, "Categorias", barra flutuante "Sua Comanda", folha "Seu Pedido" (carrinho, com cupom), pílula/folha de status (se houver pedido de teste), "Conta da Mesa". Esperado: todas seguem o tema; só o cabeçalho `--ink`, a barra "Comanda aberta" e a tela de entrada por PIN continuam escuros (exceções de marca registradas).

- [ ] **Step 6: Capturar as outras janelas em folha do painel**

"Falhas de sincronização" (`StoreModule.tsx:957`), "Histórico de Turnos" (`:7697`), "Impressão automática (Caixa)" (`CaixaPrintStation.tsx:1282`): claro e escuro. Se alguma tiver texto/ícone com cor fixa que só funcionava sobre fundo escuro, trocar pelos tokens e anotar no commit.

- [ ] **Step 7: Corrigir o que a varredura achar e registrar a regra**

Cada achado: corrigir com tokens (nunca branco/preto fixo fora de fundo de marca), rodar `npx tsc --noEmit` + `npx tsx scripts/testes/temaCoerente.test.ts`, commit próprio. Acrescentar em `AGENTS.md`, seção "Design system", logo após o parágrafo da `.force-light`:

```md
**Tema (04/10/2026): só a preferência da pessoa decide.** Janelas (`Modal`, `BottomSheet` do cardápio),
barras flutuantes e pílulas usam `--surface`/`--text`/`--border` e acompanham `.dark` no `<html>`; o
desfoque fica só no fundo (scrim). O vidro escuro fixo (`.on-glass`, `.u-glass-cart`) foi removido e
`scripts/testes/temaCoerente.test.ts` falha se voltar. Exceções de marca (ficam escuras de propósito):
cabeçalho/barras `--ink` do cardápio do cliente e a tela de entrada por PIN (`u-glass-modal`, 1 uso).
Branco fixo só sobre fundo de marca (botão `--brand-fill`, badges `-fill`, ícones sobre foto).
```

- [ ] **Step 8: Limpeza e verificação final**

Apagar mesa/itens/usuário QA criados; restaurar `config.order_flow` e qualquer outro valor alterado na ZZ; parar o `npm run dev`; `git status` limpo (capturas não entram no repo). Rodar `npx tsc --noEmit && for t in scripts/testes/*.test.ts; do npx tsx "$t" || echo "FALHOU $t"; done` — esperado: nenhum `FALHOU`.

- [ ] **Step 9: Commit**

```bash
git add AGENTS.md
git commit -m "docs(tema): regra de tema (só a preferência da pessoa decide) e exceções de marca

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7"
```

(As capturas ficam na pasta de scratch; a entrega ao dono é o conjunto delas — claro/escuro × computador/celular — antes de qualquer deploy.)

---

## Perguntas em aberto (para o dono, não bloqueiam as Tasks 1–5)

1. **Exceções de marca do cardápio do cliente:** manter o cabeçalho/barras em tom escuro (`--ink`, estilo "carta de vinhos") mesmo em tema claro, ou fazer o cabeçalho também seguir o tema? O plano mantém (é identidade, não "janela escura aleatória"); a Task 6 mostra como fica.
2. **Tela de entrada por PIN (`ClientModule.tsx:931`):** continua um overlay escuro com texto branco (1 uso de `u-glass-modal`), ou vira uma tela clara/temática?

## Self-review

- **Cobertura do brief:** (A) causa raiz e correção central no `Modal` (T1), `BottomSheet` + cupom (T2), barras flutuantes/pílula + CSS morto (T3), guarda automática (T1–T3), limpeza de `surface="opaque"` (T1), achar outras cores fixas (achados acima: só sobre fundo de marca; T6 confere janelas restantes), varredura visual nos dois temas, computador e celular em loja de teste (T6). (B) janela larga `size="lg"` (T5), nome sem truncar (T5, `break-words`), colunas hora/mesa/qtd+produto/quem/local/impressão (T5), agrupar mesa/hora e filtros local/estado/busca/meus-todos e resumo com falhas (T4+T5), lógica em lib pura com testes (T4), Reimprimir preservado (T5, mesma condição de antes).
- **Placeholders:** nenhum.
- **Tipos:** `LinhaPedido`, `Filtros`, `FILTROS_PADRAO`, `filtrarLinhas`, `contarPorLocal`, `resumir`, `agruparPorMesa`, `agruparPorHora`, `horaCurta` definidos na T4 e usados com os mesmos nomes na T5; `Modal` sem `surface` na T1 e chamadores ajustados na mesma task.
- **Review Focus:** 1 → T2 (token do botão) + T6 Step 4; 2 → T1 Steps 1/6; 3 → T4 (teste "sem nome nunca é meu") + T5 (mensagens vazias); 4 → T5 (`min-w-0`/`break-words`) + T6 Step 3; 5 → T4 (mesa `'?'`, 00h).
