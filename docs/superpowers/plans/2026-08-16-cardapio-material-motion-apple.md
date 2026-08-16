# Cardápio: material de vidro + motion Apple — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao cardápio do cliente (`ClientModule.tsx`) um material de vidro/translúcido em todo chrome fixo e um sistema de movimento com spring de verdade (incluindo bottom sheets que arrastam com o dedo), substituindo o CSS estático atual.

**Architecture:** Tudo dentro de `components/modules/ClientModule.tsx`, exceto uma extensão opt-in no `Modal` compartilhado (`components/ui.tsx`) e uma classe utilitária nova em `app/globals.css`. Nenhuma mudança de comportamento pra quem não optar explicitamente (lojista/admin continuam idênticos). Sem migration, sem mudança de servidor — é 100% cliente.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, lib `motion` (já instalada nesta sessão, `package.json`), Tailwind v4 + CSS custom properties existentes.

**Spec:** `docs/plans/2026-08-16-cardapio-material-motion-apple.md` — os 5 princípios lá (vidro só em chrome fixo, spring não duração fixa, arrastar 1:1 com rubber-band, decisão por velocidade, reduced-motion/transparency) valem implicitamente em toda task abaixo.

## Global Constraints

- Vidro (`backdrop-filter`) só em elementos fixos/sticky/modal — **nunca** em algo que rola junto com a página (Princípio 1 da spec).
- Todo movimento novo usa `type: 'spring'`, nunca `duration` com easing CSS craft nem `stiffness/damping` ad-hoc — usar sempre as 2 constantes definidas na Task 1 (`SPRING_TAP`, `SPRING_SHEET`).
- Bottom sheets arrastam 1:1 com o dedo, resistem com rubber-band, decidem fechar pela velocidade do gesto (`info.velocity.y`), não só posição.
- `components/ui.tsx` (Modal compartilhado) só muda via prop nova opt-in — comportamento default idêntico ao de hoje pra todo consumidor existente (admin/lojista).
- Depois de cada task: `npx tsc --noEmit` limpo e `npm run build` limpo antes de commitar (projeto não tem suite de teste automatizado — QA real é `npm run dev` + Playwright manual, ver Task 7).

---

### Task 1: Fundação — presets de spring, `MotionConfig`, classe `.u-glass`

**Files:**
- Modify: `app/globals.css` (perto dos outros utilitários `.u-*`, ver `.u-grow-in`/`.u-stagger`)
- Modify: `components/modules/ClientModule.tsx` (consts perto de `WINE_GOLD`, e o `return` raiz do componente `ClientModule`)

**Interfaces:**
- Produces: `SPRING_TAP`, `SPRING_SHEET` (constantes de transição `motion`, importadas/usadas por todas as tasks seguintes), classe CSS `.u-glass`.

- [ ] **Step 1: Adicionar a classe `.u-glass` em `app/globals.css`**

Colar logo depois do bloco `.u-grow-in`/`.u-soft-bounce` (perto da linha ~380, mesma área dos utilitários de movimento):

```css
/* Vidro/translúcido — só pra chrome fixo (sticky/fixed/modal), nunca pra
   conteúdo que rola (custo de repaint de GPU). Ver docs/plans/2026-08-16-
   cardapio-material-motion-apple.md, Princípio 1. */
.u-glass {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
@media (prefers-reduced-transparency: reduce) {
  .u-glass {
    background: rgba(20, 23, 31, 0.95);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
```

**Step 2: Verificar visualmente**

Não há nada consumindo a classe ainda — só confirmar que o CSS não quebra o build:

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit && npm run build
```
Esperado: limpo, sem erro.

- [ ] **Step 3: Adicionar as constantes de spring em `ClientModule.tsx`**

Logo depois de `const WINE_GOLD_DARK = '#8A6A2B';` (topo do arquivo):

```tsx
// Presets de spring validados com o usuário no companion visual de
// brainstorming (2026-08-16) — não são valores arbitrários. SPRING_TAP:
// feedback de toque, sem bounce (damping 1.0 da Apple — botão não carrega
// momentum de gesto). SPRING_SHEET: abrir/fechar/arrastar de folha e
// acordeão, bounce leve (~damping 0.82 testado na demo interativa, bate
// com o valor real que a Apple documenta pra drawer/sheet).
const SPRING_TAP = { type: 'spring' as const, bounce: 0, duration: 0.15 };
const SPRING_SHEET = { type: 'spring' as const, bounce: 0.18, duration: 0.4 };
```

**Step 4: Envolver o cardápio em `MotionConfig`**

Achar o `return` principal do componente `ClientModule` (o que renderiza `<div className="bg-[var(--bg)] min-h-screen pb-32">`) e envolver com `MotionConfig` — isso cobre `prefers-reduced-motion` automaticamente em TODO `motion.*`/`drag` usado nas tasks seguintes, sem checar manualmente em cada lugar:

```tsx
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
```

(troca o import já existente na linha 19, que hoje é `import { motion, AnimatePresence } from 'motion/react';`)

E no JSX, envolver o `return` da função `ClientModule` (não dos subcomponentes) assim:

```tsx
return (
    <MotionConfig reducedMotion="user">
        <div className="bg-[var(--bg)] min-h-screen pb-32">
            {/* ...conteúdo existente, sem mudança... */}
        </div>
    </MotionConfig>
);
```

**Step 5: Typecheck + build**

```bash
npx tsc --noEmit && npm run build
```
Esperado: limpo.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css components/modules/ClientModule.tsx
git commit -m "feat(cardapio): fundação de motion — presets de spring, MotionConfig, .u-glass"
```

---

### Task 2: Vidro estático — barra de busca/ordenação + botão flutuante de comanda

**Files:**
- Modify: `components/modules/ClientModule.tsx`

**Interfaces:**
- Consumes: classe `.u-glass` (Task 1).

- [ ] **Step 1: Barra de busca/ordenação sticky**

Achar (linha ~2300):
```tsx
            <div className={`px-4 py-3 bg-[var(--surface)] border-b border-[var(--border)] sticky ${isWaitingBill ? 'top-9' : 'top-0'} z-10`}>
```
Trocar por (fundo `--ink` por baixo do vidro, já que o header também é `--ink` — vidro sobre superfície clara ficaria errado):
```tsx
            <div className={`px-4 py-3 u-glass sticky ${isWaitingBill ? 'top-9' : 'top-0'} z-10`} style={{ background: 'rgba(10,13,19,0.7)', backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)' }}>
```

(a classe `.u-glass` cobre o `prefers-reduced-transparency`; o `style` inline sobrescreve só a cor de fundo pro tom certo sobre `--ink` — a classe fica com a borda/blur base, o style ganha por especificidade de inline)

**Step 2: Botão flutuante "Ver Comanda"**

Achar (linha ~2461, dentro do bloco "Floating Cart Button"):
```tsx
                <div className="fixed bottom-4 left-4 right-4 z-40 flex flex-col gap-3 animate-[slideUp_0.25s_cubic-bezier(0.22,1,0.36,1)]">
                    {cart.length > 0 && (
                        <div className="text-white px-4 pt-3 pb-4 rounded-[var(--r-lg)] flex flex-col gap-3 border" style={{ background: 'var(--ink)', borderColor: 'rgba(212,175,92,0.3)', boxShadow: '0 12px 34px -8px rgba(0,0,0,0.45)' }}>
```
Trocar o `background: 'var(--ink)'` do card da comanda por vidro de verdade:
```tsx
                <div className="fixed bottom-4 left-4 right-4 z-40 flex flex-col gap-3">
                    {cart.length > 0 && (
                        <motion.div
                            initial={{ y: 40, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 40, opacity: 0 }}
                            transition={SPRING_SHEET}
                            className="text-white px-4 pt-3 pb-4 rounded-[var(--r-lg)] flex flex-col gap-3 border"
                            style={{ background: 'rgba(10,13,19,0.72)', backdropFilter: 'blur(16px) saturate(160%)', WebkitBackdropFilter: 'blur(16px) saturate(160%)', borderColor: 'rgba(212,175,92,0.3)', boxShadow: '0 12px 34px -8px rgba(0,0,0,0.45)' }}
                        >
```

Isso troca a `div` estática por `motion.div` (precisa fechar com `</motion.div>` em vez de `</div>` no fim desse bloco — achar o `</div>` correspondente, é o que fecha logo antes do `{latestMesaOrder && (`). Como o bloco todo só existe quando `cart.length > 0`, envolver com `AnimatePresence` pra ter saída animada também — trocar o `{cart.length > 0 && (...)}` por:

```tsx
                    <AnimatePresence>
                        {cart.length > 0 && (
                            <motion.div
                                key="cart-bar"
                                initial={{ y: 40, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: 40, opacity: 0 }}
                                transition={SPRING_SHEET}
                                className="text-white px-4 pt-3 pb-4 rounded-[var(--r-lg)] flex flex-col gap-3 border"
                                style={{ background: 'rgba(10,13,19,0.72)', backdropFilter: 'blur(16px) saturate(160%)', WebkitBackdropFilter: 'blur(16px) saturate(160%)', borderColor: 'rgba(212,175,92,0.3)', boxShadow: '0 12px 34px -8px rgba(0,0,0,0.45)' }}
                            >
                                {/* ...conteúdo interno existente (ícone+texto+total+botão Ver Comanda), sem mudança... */}
                            </motion.div>
                        )}
                    </AnimatePresence>
```

**Step 3: Verificar visualmente**

```bash
npm run dev
```
Abrir `http://localhost:3000/c/vieras-vinhos`, rolar a página com um item no carrinho (adicionar um produto primeiro), confirmar: (a) a barra de busca fica translúcida com o conteúdo da lista visível "atrás" dela ao rolar, (b) o card da comanda no rodapé também fica translúcido, (c) a lista de produtos ao fundo continua **sólida**, sem nenhum blur (Princípio 1 — checar isso especificamente).

- [ ] **Step 4: Typecheck + build + commit**

```bash
npx tsc --noEmit && npm run build
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): vidro de verdade na barra de busca e no card de comanda"
```

---

### Task 3: `BottomSheet` primitivo (arrastar pra fechar) + `CartModal`/`OrderStatusModal` adotam

**Files:**
- Modify: `components/modules/ClientModule.tsx`

**Interfaces:**
- Produces: componente `BottomSheet` — `{ isOpen: boolean, onClose: () => void, children: React.ReactNode, maxWidth?: string }`. Renderiza o scrim + a folha arrastável com vidro; quem usa só põe o CONTEÚDO interno dentro (header/body/footer), sem se preocupar com scrim/drag/spring.
- Consumes: `SPRING_SHEET` (Task 1), `.u-glass`.

- [ ] **Step 1: Criar o componente `BottomSheet`**

Adicionar logo antes de `const CartModal` (linha ~1203):

```tsx
// Bottom sheet reutilizável (2026-08-16): scrim + folha que arrasta com o
// dedo de verdade (1:1, não só anima no final), resiste com rubber-band
// ao passar do topo, e decide fechar-ou-voltar pela VELOCIDADE do gesto
// ao soltar (projeção de momentum), não só pela distância arrastada — ver
// docs/plans/2026-08-16-cardapio-material-motion-apple.md, Princípio 4.
// CartModal e OrderStatusModal usam este componente pro scrim/folha/gesto;
// cada um só cuida do próprio conteúdo interno (header/body/footer).
const DISMISS_VELOCITY = 500; // px/s — flick rápido pra baixo já fecha
const DISMISS_OFFSET_RATIO = 0.35; // arrastar >35% da altura da folha fecha mesmo sem flick

function BottomSheet({ isOpen, onClose, children, maxWidth = 'max-w-md' }: {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    maxWidth?: string;
}) {
    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="scrim"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
                    style={{ background: 'rgba(10,13,19,0.6)' }}
                    onClick={onClose}
                >
                    <motion.div
                        key="sheet"
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={SPRING_SHEET}
                        drag="y"
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0.05, bottom: 0.5 }}
                        onDragEnd={(_e, info) => {
                            if (info.velocity.y > DISMISS_VELOCITY || info.offset.y > window.innerHeight * DISMISS_OFFSET_RATIO) {
                                onClose();
                            }
                        }}
                        className={`w-full ${maxWidth} rounded-t-[var(--r-lg)] sm:rounded-[var(--r-lg)] overflow-hidden flex flex-col max-h-[90vh] u-glass`}
                        style={{ background: 'rgba(20,23,31,0.85)', boxShadow: '0 -8px 40px -8px rgba(0,0,0,0.5)' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Alça visual — sinaliza que dá pra arrastar (achado da
                            skill apple-design: "swipe actions must show clear
                            affordance"). Só decorativo, o gesto funciona na folha
                            inteira, não só na alça. */}
                        <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
                            <div className="w-10 h-1 rounded-full bg-white/20" />
                        </div>
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
```

**Step 2: Migrar `CartModal` pra usar `BottomSheet`**

Trocar (linha ~1213-1217 e o fechamento correspondente no fim, linha ~1296):
```tsx
    if(!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] animate-[fadeIn_0.2s_ease-out]">
            <div className="w-full max-w-md bg-[var(--surface)] rounded-t-[var(--r-lg)] sm:rounded-[var(--r-lg)] overflow-hidden animate-[slideUp_0.25s_cubic-bezier(0.22,1,0.36,1)] flex flex-col max-h-[90vh]" style={{boxShadow:'var(--shadow-md), 0 0 0 1px var(--border)'}}>
```
por:
```tsx
    return (
        <BottomSheet isOpen={isOpen} onClose={onClose}>
```
E o fechamento no fim do componente (era `</div></div>);` fechando as duas divs antigas) vira só `</BottomSheet>);` (uma div a menos — `BottomSheet` já fornece o container arrastável).

O conteúdo interno (header com título+X, lista de itens, footer com total+botões) continua **idêntico**, só perde um nível de indentação de div (o wrapper `w-full max-w-md ...` some, `BottomSheet` já é esse wrapper).

**Step 3: Migrar `OrderStatusModal` do mesmo jeito**

Mesma troca no componente `OrderStatusModal` (linha ~524-535 e fechamento correspondente): substituir a `div` de scrim + a `div` da folha por `<BottomSheet isOpen={isOpen} onClose={onClose}>`, manter o conteúdo interno (header "Acompanhar Pedido" + corpo) intacto, fechar com `</BottomSheet>`.

**Step 4: Verificar de verdade — arrastar com o dedo**

```bash
npm run dev
```
No `http://localhost:3000/c/vieras-vinhos` (emulação mobile no DevTools, ou celular de verdade): adicionar item, abrir "Ver Comanda", **arrastar a folha pra baixo com o dedo** — confirmar que ela segue o dedo em tempo real (não só anima no final), que resiste (rubber-band) se tentar arrastar pra cima do topo, que um flick rápido pra baixo fecha mesmo sem arrastar muito, e que soltar no meio sem flick volta pro lugar com a mola.

- [ ] **Step 5: Typecheck + build + commit**

```bash
npx tsc --noEmit && npm run build
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): BottomSheet arrastável (drag-to-dismiss) pra CartModal e OrderStatusModal"
```

---

### Task 4: Acordeão de categoria — recalibrar pro spring validado + linguagem de vidro sem blur

**Files:**
- Modify: `components/modules/ClientModule.tsx`

**Interfaces:**
- Consumes: `SPRING_TAP`, `SPRING_SHEET` (Task 1).

- [ ] **Step 1: Padronizar os 3 springs do acordeão pras constantes novas**

Achar os 3 pontos (linhas ~2374, ~2383, ~2399, dentro do `.map` de `visibleCategories`) e trocar cada `transition={{ type: 'spring', ... }}` inline pela constante correspondente:

- Botão do cabeçalho (`whileTap={{ scale: 0.98 }}`): trocar `transition={{ type: 'spring', stiffness: 500, damping: 30 }}` por `transition={SPRING_TAP}`.
- Chevron (`animate={{ rotate: expanded ? 180 : 0 }}`): trocar `transition={{ type: 'spring', stiffness: 300, damping: 22 }}` por `transition={SPRING_SHEET}`.
- Altura do conteúdo (`animate={{ height: expanded ? 'auto' : 0 }}`): já usa `transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}` — trocar por `transition={SPRING_SHEET}` (mesmo valor, só padroniza o nome — `bounce: 0.18` vs `0.15` é a mesma faixa "leve", ajustado pro valor exato validado no companion).

**Step 2: Vidro sem blur nas linhas de categoria (Princípio 2 da spec)**

Achar o botão do cabeçalho de categoria:
```tsx
                                className="w-full flex items-center gap-3 py-4 text-left u-motion hover:bg-[var(--surface-2)]/60 rounded-[var(--r-sm)] px-1.5 -mx-1.5"
```
Trocar por (cor/borda translúcida igual ao `.u-glass`, sem `backdrop-filter` — a linha rola junto com a página, não pode ter blur):
```tsx
                                className="w-full flex items-center gap-3 py-4 text-left u-motion rounded-[var(--r-md)] px-3 -mx-1.5 mt-1.5"
                                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
```

(o `hover:bg-[var(--surface-2)]/60` sai porque o fundo já não é mais transparente puro — trocar hover por leve aumento de opacidade via `whileHover` do `motion.button`, já que o botão já é `motion.button` desde a rodada anterior: adicionar `whileHover={{ backgroundColor: 'rgba(255,255,255,0.07)' }}` nas props do mesmo botão.)

**Step 3: Verificar visualmente**

Rolar a lista de categorias — confirmar que cada linha tem a "cara" de vidro (fundo sutilmente claro, borda fina) mas **sem nenhum blur** (o texto atrás, se houver, nunca desfoca — só não tem nada atrás mesmo, é só pra confirmar que não tem `backdrop-filter` aplicado por engano). Tocar pra expandir/recolher e sentir se o bounce está no mesmo nível validado no companion.

- [ ] **Step 4: Typecheck + build + commit**

```bash
npx tsc --noEmit && npm run build
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): acordeão de categoria com spring padronizado e linguagem de vidro sem blur"
```

---

### Task 5: `Modal` compartilhado ganha variante `sheet` opt-in — `ProductModal` e `BillSplitter` adotam

**Files:**
- Modify: `components/ui.tsx`
- Modify: `components/modules/ClientModule.tsx`

**Interfaces:**
- Produces (em `ui.tsx`): prop nova `variant?: 'center' | 'sheet'` no `Modal` (default `'center'` — comportamento 100% idêntico ao de hoje pra quem não passar).
- Consumes: `motion`/`AnimatePresence` (precisa importar em `ui.tsx`, ainda não importado lá).

- [ ] **Step 1: Adicionar a prop `variant` ao `Modal`**

Em `components/ui.tsx`, no topo do arquivo, adicionar o import:
```tsx
import { motion, AnimatePresence } from 'motion/react';
```

Na assinatura do `Modal` (hoje):
```tsx
export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}> = ({ isOpen, onClose, title, children, width = 'max-w-md' }) => {
```
Trocar por:
```tsx
export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
  // 'sheet' (opt-in, 2026-08-16): vidro + spring + arrastar pra fechar no
  // mobile, igual ao BottomSheet do cardápio do cliente. Default 'center'
  // preserva o comportamento de sempre (CSS fadeIn/slideUp, sem drag) —
  // nenhum consumidor existente (admin/lojista) muda sem passar a prop.
  variant?: 'center' | 'sheet';
}> = ({ isOpen, onClose, title, children, width = 'max-w-md', variant = 'center' }) => {
```

Na parte final do componente (o `if (!isOpen) return null; return (...)`), envolver a branch nova ANTES do return de sempre:

```tsx
  if (!isOpen) return null;

  if (variant === 'sheet') {
    return (
      <AnimatePresence>
        <motion.div
          key="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(10,13,19,0.6)' }}
          onClick={onClose}
        >
          <motion.div
            key="sheet"
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', bounce: 0.18, duration: 0.4 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.5 }}
            // Mesmos limiares do BottomSheet em ClientModule.tsx
            // (DISMISS_VELOCITY=500, DISMISS_OFFSET_RATIO=0.35) — duplicado
            // aqui porque ui.tsx não importa de ClientModule.tsx; se um
            // valor mudar, mudar os dois juntos.
            onDragEnd={(_e, info) => {
              if (info.velocity.y > 500 || info.offset.y > window.innerHeight * 0.35) onClose();
            }}
            className={`w-full ${width} rounded-t-[var(--r-lg)] sm:rounded-[var(--r-lg)] overflow-hidden max-h-[90vh] flex flex-col`}
            style={{ background: 'rgba(20,23,31,0.85)', backdropFilter: 'blur(16px) saturate(160%)', WebkitBackdropFilter: 'blur(16px) saturate(160%)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 -8px 40px -8px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
              <h3 id={titleId} className="text-[15px] font-semibold text-white">{title}</h3>
              <button onClick={onClose} className="text-white/60 hover:text-white hover:bg-white/10 p-1 rounded-[var(--r-sm)] u-motion">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">{children}</div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

```

Logo depois desse bloco novo (o `if (variant === 'sheet') { ... }`), o `return (...)` que já existe hoje no arquivo (o `<div className="fixed inset-0 z-50 flex items-center justify-center ...">` com `animate-[fadeIn...]`/`animate-[slideUp...]`) **fica exatamente como está, sem nenhuma edição** — é o caminho `variant === 'center'` (default), só passa a ser alcançado depois do `if` novo em vez de ser o único caminho.

**Nota importante pro executor:** o `useEffect` de focus trap/Escape já existente no `Modal` (usa `containerRef`) continua funcionando pras duas variantes sem mudança — ele já busca `containerRef.current` genericamente, e a variante `sheet` também usa `ref={containerRef}` no elemento certo.

**Step 2: `ProductModal` (em `ClientModule.tsx`) adota `variant="sheet"`**

Achar o uso de `<Modal isOpen={!!product} onClose={onClose} title={product.name}>` (dentro do componente `ProductModal`) e adicionar `variant="sheet"`:
```tsx
        <Modal isOpen={!!product} onClose={onClose} title={product.name} variant="sheet">
```

**Step 3: `BillSplitter` adota `variant="sheet"`**

Achar `<Modal isOpen={true} onClose={onClose} title="Conta da Mesa">` e trocar por:
```tsx
        <Modal isOpen={true} onClose={onClose} title="Conta da Mesa" variant="sheet">
```

**Step 4: Verificar backward-compat dos OUTROS consumidores do `Modal`**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
grep -rn "<Modal " components/modules/AdminModule.tsx components/modules/StoreModule.tsx
```
Confirmar que NENHUM desses call sites passa `variant` — todos continuam no default `'center'`, comportamento idêntico ao de hoje. Rodar `npm run dev`, abrir `/painel` e `/loja`, abrir qualquer modal existente lá (ex.: "Nova Loja"), confirmar visualmente que não mudou nada.

**Step 5: Verificar `ProductModal`/`BillSplitter` de verdade — arrastar**

No cardápio do cliente, tocar num produto (abre `ProductModal` como sheet), arrastar pra baixo pra fechar, confirmar rubber-band/velocidade igual à Task 3. Repetir abrindo "Conta" numa mesa (`BillSplitter`).

- [ ] **Step 6: Typecheck + build + commit**

```bash
npx tsc --noEmit && npm run build
git add components/ui.tsx components/modules/ClientModule.tsx
git commit -m "feat(ui): Modal ganha variant='sheet' opt-in (vidro+spring+arrastar); ProductModal e BillSplitter adotam"
```

---

### Task 6: Varredura de `whileTap` nos CTAs restantes do cardápio

**Files:**
- Modify: `components/modules/ClientModule.tsx`

**Interfaces:**
- Consumes: `SPRING_TAP` (Task 1).

- [ ] **Step 1: Listar os CTAs do cardápio que ainda usam só CSS `:active` (via `u-press`)**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
grep -n "u-press\b" components/modules/ClientModule.tsx
```

Cada resultado é um candidato — os que já viraram `motion.button` (quick-add "+", cabeçalho de categoria) não precisam mudar de novo.

**Step 2: Converter os botões de ação restantes**

Para cada `<Button ...>` do componente `ui.tsx` usado dentro do fluxo de compra do cardápio (ex.: "Adicionar" no `ProductModal`, "Confirmar Pedido"/"Adicionar Mais" no `CartModal`, "Abrir Mesa"/"Entrar" no `LoginScreen`), o `Button` compartilhado já tem `u-press` (CSS). Pra ganhar spring de verdade SEM mexer no componente `Button` (que é usado em todo o app), envolver o botão especificamente do cardápio com um wrapper `motion.span`/`motion.div` local:

Exemplo concreto — botão "Adicionar" do `ProductModal` (achar `<Button className="w-full mt-4 h-12 text-lg" disabled={missingRequired} onClick={...}>`):
```tsx
                <motion.div whileTap={{ scale: 0.97 }} transition={SPRING_TAP}>
                    <Button className="w-full mt-4 h-12 text-lg" disabled={missingRequired} onClick={() => { onAdd(qty, notes, selectedOptions); onClose(); }}>
                        Adicionar • R$ {(unitPrice * qty).toFixed(2)}
                    </Button>
                </motion.div>
```

Repetir o mesmo padrão (`motion.div` com `whileTap`/`SPRING_TAP` envolvendo o `<Button>` existente, sem mudar nada dentro) para: "Confirmar Pedido" e "Adicionar Mais" no `CartModal`, "Abrir Mesa"/"Entrar / Recuperar" no `LoginScreen`.

**Step 3: Verificar tátil**

`npm run dev`, tocar em cada um desses botões (emulação touch no DevTools ou celular), confirmar feedback de escala instantâneo e sem bounce (é `SPRING_TAP`, não `SPRING_SHEET` — não deve balançar).

- [ ] **Step 4: Typecheck + build + commit**

```bash
npx tsc --noEmit && npm run build
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): whileTap com spring nos CTAs restantes do fluxo de compra"
```

---

### Task 7: Verificação final + deploy

**Files:** nenhum (só verificação e deploy).

- [ ] **Step 1: Build de produção limpo**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit && npm run build
```

- [ ] **Step 2: Walkthrough visual completo (Playwright, `npm run dev` local)**

Cobrir, na Bistrô Demo ou Vieras e Vinhos (lojas de teste seguras, nunca loja real de cliente):
- Cardápio carrega, barra de busca e card de comanda com vidro visível, lista de produtos sólida (sem blur) ao rolar por trás da barra sticky.
- Acordeão expande/recolhe com o bounce validado, linhas de categoria com cara de vidro sem blur.
- Adicionar item sem sessão → modal de PIN abre, completa sozinho após login (fluxo já existente, só confirmar que não quebrou).
- Abrir `ProductModal` num produto com foto e sem foto — arrastar pra fechar nos dois casos.
- Abrir `CartModal` (Ver Comanda) com itens — arrastar pra fechar, confirmar rubber-band subindo e fechar com flick rápido descendo.
- Abrir `OrderStatusModal` (se houver pedido ativo) — mesmo teste de arrastar.
- Numa mesa, abrir "Conta" (`BillSplitter` como sheet) — mesmo teste.
- Emular `prefers-reduced-motion: reduce` no DevTools (Rendering tab → Emulate CSS media feature) e repetir os testes acima — tudo deve virar instantâneo/cross-fade, sem spring nem arrastar.
- Emular `prefers-reduced-transparency: reduce` (mesma aba) — confirmar que o vidro vira sólido (sem blur) em todos os pontos.

- [ ] **Step 3: Verificar `/painel` e `/loja` não mudaram**

Login universal (`equipe@norteparanegocios.com.br`), abrir qualquer modal em Admin e Lojista (ex.: "Nova Loja", cadastro de usuário), confirmar visualmente idêntico ao de antes desta rodada (Task 5, Step 4 já cobriu isso, esse é só o smoke test final).

- [ ] **Step 4: Deploy pro `testvendase`**

```bash
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh"
curl -s -o /dev/null -w "%{http_code}\n" "https://testvendase.norteparanegocios.com.br/c/vieras-vinhos"
```
Esperado: `200`, e o serviço `ntb-vendas` reiniciado sem erro no log do `deploy.sh`.

- [ ] **Step 5: Print pro usuário**

Mandar pelo menos 2 capturas (celular real ou emulação): acordeão expandido com vidro visível, e o `CartModal`/`ProductModal` a meio caminho de ser arrastado (mostra o gesto em andamento).
