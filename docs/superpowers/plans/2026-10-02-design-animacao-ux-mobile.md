# Design, Animação & UX Mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Melhorar a qualidade visual, animações e experiência mobile do Norte Vendas com base em 3 relatórios de análise (Design Visual, Motion Design, UX Mobile) entregues por agentes Opus 5.5.

**Architecture:** Mudanças incrementais em CSS tokens, componentes UI base (ui.tsx), e módulos principais (ClientModule.tsx, StoreModule.tsx). Cada task é independente e testável isoladamente. Não há mudanças de schema, API ou banco de dados — apenas frontend.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Framer Motion (motion/react), Supabase self-hosted

**Spec:** Relatórios dos agentes Opus em `~/ClaudeGerado/norte-vendas-benchmark-2026-10-02.md` + resultados inline dos agentes (Design Visual, Animação/Motion, UX Mobile)

## Global Constraints

- Deploy manual via `deploy.sh` no Contabo (185.193.66.240) — nunca fazer deploy sem OK explícito
- Desktop via `publish.sh`, Android via `publish-android.sh` — version bump obrigatório antes de publicar
- Loja teste: ZZ Laboratorio (`f33b4310-ff0a-487c-a3b1-6e5d-4f8a9e1a6c3d`) — NUNCA mexer no Sertão real sem OK
- Performance budget Android 8+/2GB RAM: animações só em `transform` e `opacity` (GPU-composited), nunca em `width`/`height`/`top`/`left`
- Princípio de restraint: NÃO animar troca de quantidade +/-, navegação teclado, formulários, tabelas de dados, status badges (exceto KDS), impressão/fiscal, offline banner
- Presets de spring existentes em `lib/motion.ts`: `SPRING_TAP` (bounce 0, 150ms), `SPRING_SHEET` (bounce 0.18, 400ms), `SPRING_UI` (bounce 0, 350ms), `LIST_ITEM_MOTION` — não criar novos presets sem validação visual com o dono
- Tokens CSS em `app/globals.css`: `--dur-fast: 120ms`, `--dur: 180ms`, `--dur-slow: 280ms`, `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`

## Review Focus

1. **Touch targets abaixo de 44px em mobile** — qualquer elemento interativo tocado pelo cliente/garçom deve ter área mínima 44×44px (WCAG/Apple HIG). Testar: abrir cardápio no celular, tocar select de mesa, tocar chip de observação, tocar botão fechar login.
2. **Animações quebrando em `prefers-reduced-motion`** — todas as animações novas devem respeitar a media query existente em `globals.css:430-438`. Testar: ativar "Reduzir movimento" nas configurações de acessibilidade do macOS/iOS e verificar que nada anima.
3. **Regression visual no dark mode** — mudanças em tokens CSS (`--bg`, `--surface`, sombras) afetam ambos os temas. Testar: alternar tema claro/escuro em cada tela modificada.
4. **Performance em lista grande de produtos** — virtualização (Task 7) não pode quebrar scroll, busca, favoritos nem categorias por horário. Testar: categoria com 50+ produtos, buscar, filtrar por favorito, trocar categoria.
5. **Modal desktop vs mobile** — a animação de entrada é condicional por breakpoint (`phone` flag). Testar: abrir modal em desktop (scale+fade) e em celular (slide Y) — ambos devem funcionar sem flash de transparência.

---

### Task 1: Input com borda visível + Dark mode --bg suavizado

**Files:**
- Modify: `components/ui.tsx:78-82` (Input component)
- Modify: `app/globals.css:196` (dark mode --bg)

**Interfaces:**
- Consumes: nenhum (mudança puramente visual)
- Produces: Input com borda visível em ambos os temas; dark mode com fundo menos agressivo

- [ ] **Step 1: Verificar o estado atual**

Run: `cd ~/Projects/norte\ para\ negocios/ntb\ vendas && grep -n 'border-0 bg-\[var(--surface-2)\]' components/ui.tsx`
Expected: linha ~80 com `border-0 bg-[var(--surface-2)]`

- [ ] **Step 2: Adicionar borda ao Input**

Em `components/ui.tsx`, na linha do `<input>` dentro do componente `Input`, trocar:
```
border-0 bg-[var(--surface-2)]
```
por:
```
border border-[var(--border)] bg-[var(--surface)]
```

O resultado final da className do input deve ser:
```tsx
className={`w-full rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] h-[38px] px-3 text-[15px] max-sm:text-base max-sm:h-11 text-[var(--text)] placeholder:text-[var(--text-muted)]/70 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 transition-all ${
  error ? 'ring-2 ring-[var(--err)]/50' : ''
} ${className}`}
```

- [ ] **Step 3: Suavizar dark mode --bg**

Em `app/globals.css`, dentro do bloco `.dark { ... }`, trocar:
```css
--bg: #000000;
```
por:
```css
--bg: #0a0a0c;
```

- [ ] **Step 4: Verificar visualmente**

Run: `cd ~/Projects/norte\ para\ negocios/ntb\ vendas && npm run dev`
Expected: servidor sobe em localhost:3000. Abrir no browser, verificar:
1. Inputs têm borda visível em tema claro e escuro
2. Dark mode tem fundo levemente azulado/cinza em vez de preto puro
3. Focus ring continua funcionando (azul da marca)

- [ ] **Step 5: Commit**

```bash
git add components/ui.tsx app/globals.css
git commit -m "fix: input com borda visível + dark mode --bg suavizado (#0a0a0c)"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

### Task 2: Touch targets críticos no cardápio do cliente

**Files:**
- Modify: `components/modules/ClientModule.tsx:988` (select de mesa)
- Modify: `components/modules/ClientModule.tsx:1567` (chips de observação)
- Modify: `components/modules/ClientModule.tsx:951` (botão fechar login)

**Interfaces:**
- Consumes: nenhum
- Produces: todos os touch targets interativos do cliente ≥ 44px

- [ ] **Step 1: Select de mesa → min-h-[44px]**

Em `ClientModule.tsx`, encontrar o `<select>` de mesa (linha ~988). A className atual contém `py-2`. Trocar `py-2` por `py-3 min-h-[44px]`:

```tsx
<select
  className="w-full px-3 py-3 min-h-[44px] border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] text-sm focus:ring-2 focus:ring-[var(--brand)] focus:border-[var(--brand)] outline-none u-motion max-sm:text-base"
  value={tableId}
  onChange={e => setTableId(e.target.value)}
>
```

- [ ] **Step 2: Chips de observação → h-11**

Em `ClientModule.tsx`, encontrar os botões de sugestão de observação (linha ~1567). A className atual contém `h-9`. Trocar `h-9` por `h-11`:

```tsx
<button
  key={idx}
  type="button"
  onClick={() => setNotes(prev => (prev.trim() ? `${prev.trim()}, ${suggestion}` : suggestion).slice(0, 140))}
  className="inline-flex items-center h-11 text-[13px] font-medium px-3.5 rounded-full bg-[var(--surface-2)] text-[var(--text)] u-motion u-press-sm"
>
```

- [ ] **Step 3: Botão fechar login → w-11 h-11**

Em `ClientModule.tsx`, encontrar o botão de fechar do LoginScreen (linha ~951). A className atual contém `w-8 h-8`. Trocar por `w-11 h-11`:

```tsx
<button
  onClick={onClose}
  aria-label="Fechar e continuar vendo o cardápio"
  className="absolute top-4 right-4 w-11 h-11 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-2)] u-motion"
>
  <X size={18} />
</button>
```

- [ ] **Step 4: Verificar visualmente**

Abrir o cardápio do cliente em viewport mobile (Chrome DevTools → iPhone SE). Verificar:
1. Select de mesa tem altura confortável para toque
2. Chips de observação são fáceis de tocar
3. Botão X de fechar é grande o suficiente

- [ ] **Step 5: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "fix: touch targets críticos no cardápio do cliente (select 44px, chips 44px, fechar 44px)"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

### Task 3: Haptic feedback no botão "+" do ProductCard

**Files:**
- Modify: `components/modules/ClientModule.tsx:1165-1175` (ProductCard quick-add button)

**Interfaces:**
- Consumes: nenhum
- Produces: vibração tátil de 20ms ao tocar o botão "+" do cardápio

- [ ] **Step 1: Adicionar vibração no onClick**

Em `ClientModule.tsx`, encontrar o `<motion.button>` do quick-add no ProductCard (linha ~1165). O `onClick` atual é:
```tsx
onClick={(e) => { e.stopPropagation(); if (!disabled) onQuickAdd(product); }}
```

Trocar por:
```tsx
onClick={(e) => { e.stopPropagation(); if (!disabled) { navigator.vibrate?.(20); onQuickAdd(product); } }}
```

- [ ] **Step 2: Verificar**

Abrir o cardápio num celular Android real (ou Chrome DevTools com emulação de vibração). Tocar o "+" de um produto — deve vibrar levemente.

- [ ] **Step 3: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "feat: haptic feedback no botão + do ProductCard (vibrate 20ms)"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

### Task 4: KDS — transição de cor no status do item

**Files:**
- Modify: `components/modules/StoreModule.tsx:4735-4737` (KDS item status icons)

**Interfaces:**
- Consumes: nenhum
- Produces: transição suave de cor quando item muda de status (pending→preparing→ready→delivered)

- [ ] **Step 1: Adicionar transition-colors nos ícones de status**

Em `StoreModule.tsx`, encontrar os ícones de status do KDS (linhas ~4735-4737). Cada ícone tem uma classe de cor (`text-[var(--ok)]`, `text-[var(--info)]`, `text-[var(--warn)]`). Adicionar `transition-colors duration-300` ao container pai que envolve esses ícones.

Encontrar o `<div>` que contém os itens do resumo KDS:
```tsx
<div key={idx} className="flex justify-between items-center gap-1.5 text-[13px] text-[var(--text)]">
```

Trocar por:
```tsx
<div key={idx} className="flex justify-between items-center gap-1.5 text-[13px] text-[var(--text)] transition-colors duration-300">
```

- [ ] **Step 2: Verificar**

Abrir o KDS no painel do lojista. Mudar o status de um item (pending → preparing). A cor do ícone deve transicionar suavemente em vez de trocar instantaneamente.

- [ ] **Step 3: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat: KDS — transição suave de cor no status do item (300ms)"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

### Task 5: Badge com variantes semânticas

**Files:**
- Modify: `components/ui.tsx:526-544` (Badge component)

**Interfaces:**
- Consumes: nenhum
- Produces: Badge com prop `variant` opcional (`default` | `success` | `warning` | `critical`)

- [ ] **Step 1: Expandir o componente Badge**

Em `ui.tsx`, substituir o componente `Badge` atual por:

```tsx
export const Badge: React.FC<{
  children: React.ReactNode;
  color?: string;
  dot?: boolean;
  pulse?: boolean;
  variant?: 'default' | 'success' | 'warning' | 'critical';
}> = ({ children, color, dot, pulse, variant = 'default' }) => {
  const variantClasses = {
    default: 'bg-[var(--surface-2)] text-[var(--text-muted)]',
    success: 'bg-[var(--ok)]/10 text-[var(--ok)]',
    warning: 'bg-[var(--warn)]/10 text-[var(--warn)]',
    critical: 'bg-[var(--err-fill)] text-white',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-medium normal-case tracking-normal ${
        color || variantClasses[variant]
      }`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full bg-current flex-shrink-0 ${pulse ? 'u-pulse-dot' : ''}`}
        />
      )}
      {children}
    </span>
  );
};
```

- [ ] **Step 2: Verificar compatibilidade**

Run: `cd ~/Projects/norte\ para\ negocios/ntb\ vendas && npx tsc --noEmit 2>&1 | head -20`
Expected: zero erros. A prop `variant` é opcional com default `default`, então nenhum call site existente quebra.

- [ ] **Step 3: Commit**

```bash
git add components/ui.tsx
git commit -m "feat: Badge com variantes semânticas (success/warning/critical)"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

### Task 6: Token --r-xl + unificar raios hardcoded

**Files:**
- Modify: `app/globals.css:88` (tokens de raio)
- Modify: `components/ui.tsx:495` (Modal rounded)
- Modify: `app/page.tsx:55` (landing rounded)

**Interfaces:**
- Consumes: nenhum
- Produces: token `--r-xl: 1.375rem` (22px) substituindo todos os `rounded-[22px]` hardcoded

- [ ] **Step 1: Adicionar token --r-xl**

Em `app/globals.css`, após a linha `--r-lg: 1.125rem;`, adicionar:
```css
--r-xl: 1.375rem;
```

- [ ] **Step 2: Substituir rounded-[22px] no Modal**

Em `components/ui.tsx`, encontrar `rounded-t-[22px] sm:rounded-[22px]` na className do panel do Modal. Trocar por `rounded-t-[var(--r-xl)] sm:rounded-[var(--r-xl)]`.

- [ ] **Step 3: Substituir rounded-[22px] na landing**

Em `app/page.tsx`, encontrar `rounded-[22px]` e trocar por `rounded-[var(--r-xl)]`.

- [ ] **Step 4: Verificar**

Run: `cd ~/Projects/norte\ para\ negocios/ntb\ vendas && grep -rn 'rounded-\[22px\]' components/ app/ --include='*.tsx'`
Expected: zero resultados (todos substituídos).

- [ ] **Step 5: Commit**

```bash
git add app/globals.css components/ui.tsx app/page.tsx
git commit -m "refactor: token --r-xl (22px) substituindo rounded-[22px] hardcoded"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

### Task 7: ACTION_BG → var(--brand-fill) + sombras tokenizadas

**Files:**
- Modify: `components/modules/ClientModule.tsx:49` (ACTION_BG constant)
- Modify: `app/globals.css:91-92` (shadow tokens)
- Modify: `components/ui.tsx:496` (Modal shadow inline)

**Interfaces:**
- Consumes: nenhum
- Produces: ACTION_BG usa token CSS em vez de hex hardcoded; sombras do modal usam token

- [ ] **Step 1: Adicionar tokens de sombra especializados**

Em `app/globals.css`, após `--shadow-md`, adicionar:
```css
--shadow-modal: 0 20px 60px -12px rgba(0, 0, 0, 0.28), 0 0 0 1px var(--border);
--shadow-hero: 0 30px 60px -18px rgba(30, 27, 75, 0.45);
```

No bloco `.dark { ... }`, adicionar:
```css
--shadow-modal: 0 20px 60px -12px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--border);
--shadow-hero: 0 30px 60px -18px rgba(0, 0, 0, 0.65);
```

- [ ] **Step 2: Trocar ACTION_BG por token**

Em `ClientModule.tsx`, trocar:
```tsx
const ACTION_BG = '#484DB5';
```
por:
```tsx
const ACTION_BG = 'var(--brand-fill)';
```

Verificar que todos os usos de `ACTION_BG` funcionam com `var()` — ele é usado em `style={{ backgroundColor: ACTION_BG }}`, que aceita CSS custom properties.

- [ ] **Step 3: Trocar sombra inline do Modal por token**

Em `components/ui.tsx`, encontrar no Modal center:
```tsx
style={{ boxShadow: '0 20px 60px -12px rgba(0,0,0,0.28), 0 0 0 1px var(--border)' }}
```
Trocar por:
```tsx
style={{ boxShadow: 'var(--shadow-modal)' }}
```

- [ ] **Step 4: Trocar sombra inline da landing por token**

Em `app/page.tsx`, encontrar `boxShadow: '0 30px 60px -18px rgba(30,27,75,0.45)'` e trocar por `boxShadow: 'var(--shadow-hero)'`.

- [ ] **Step 5: Verificar**

Run: `cd ~/Projects/norte\ para\ negocios/ntb\ vendas && npx tsc --noEmit 2>&1 | head -10`
Expected: zero erros.

- [ ] **Step 6: Commit**

```bash
git add components/modules/ClientModule.tsx app/globals.css components/ui.tsx app/page.tsx
git commit -m "refactor: ACTION_BG → var(--brand-fill) + sombras tokenizadas (--shadow-modal, --shadow-hero)"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

### Task 8: Banner offline no cardápio do cliente

**Files:**
- Modify: `components/modules/ClientModule.tsx` (adicionar componente OfflineBanner + hook)

**Interfaces:**
- Consumes: nenhum
- Produces: banner amarelo discreto no topo do cardápio quando `navigator.onLine === false` ou Realtime desconecta

- [ ] **Step 1: Adicionar hook de status online**

No topo de `ClientModule.tsx`, após os imports, adicionar:

```tsx
function useOnlineStatus() {
  const [online, setOnline] = React.useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  React.useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);
  return online;
}
```

- [ ] **Step 2: Adicionar componente OfflineBanner**

Ainda em `ClientModule.tsx`, após o hook, adicionar:

```tsx
function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[200] bg-[var(--warn)] text-white text-center text-[13px] font-medium py-1.5 px-4">
      Sem conexão — pedidos podem não chegar até a cozinha
    </div>
  );
}
```

- [ ] **Step 3: Renderizar o banner**

No retorno JSX principal do `ClientModule`, adicionar `<OfflineBanner />` como primeiro filho dentro do container raiz (antes de qualquer outro conteúdo).

- [ ] **Step 4: Verificar**

Abrir o cardápio do cliente. No Chrome DevTools → Network → Offline. O banner amarelo deve aparecer no topo. Voltar para Online — o banner some.

- [ ] **Step 5: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "feat: banner offline no cardápio do cliente (aviso de desconexão)"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

### Task 9: Feedback inline no PIN da mesa

**Files:**
- Modify: `components/modules/ClientModule.tsx:1024-1042` (PIN field + error handling)

**Interfaces:**
- Consumes: nenhum
- Produces: erro de PIN mostra borda vermelha + mensagem inline abaixo do campo, além do toast existente

- [ ] **Step 1: Adicionar estado de erro do PIN**

No componente que contém o campo PIN (dentro do LoginScreen ou fluxo de acesso), adicionar um estado:
```tsx
const [pinError, setPinError] = React.useState('');
```

- [ ] **Step 2: Capturar erro no submit**

No handler que chama `openTableSession`, no catch/error, além do toast existente, setar:
```tsx
setPinError('PIN incorreto. Tente novamente.');
```

E limpar no onChange do input:
```tsx
onChange={(e) => { setPin(e.target.value); setPinError(''); }}
```

- [ ] **Step 3: Aplicar estilo de erro no input**

No `<input>` do PIN, adicionar condicional de erro na className:
```tsx
className={`... ${pinError ? 'border-[var(--err)] ring-2 ring-[var(--err)]/30' : 'border-[var(--border)]'} ...`}
```

- [ ] **Step 4: Mostrar mensagem inline**

Logo abaixo do input do PIN, adicionar:
```tsx
{pinError && <p className="text-[12px] text-[var(--err)] mt-1">{pinError}</p>}
```

- [ ] **Step 5: Verificar**

Abrir o cardápio, selecionar uma mesa ocupada, digitar PIN errado. Deve aparecer borda vermelha + mensagem "PIN incorreto" abaixo do campo, além do toast.

- [ ] **Step 6: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "feat: feedback inline no PIN da mesa (borda vermelha + mensagem)"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

### Task 10: Stagger nos ProductCards do cardápio

**Files:**
- Modify: `components/modules/ClientModule.tsx` (render loop dos ProductCards)

**Interfaces:**
- Consumes: classe `.u-stagger` já existe em `globals.css:307-310`
- Produces: primeiros 12 cards aparecem sequencialmente com delay de 30ms cada

- [ ] **Step 1: Aplicar stagger nos cards**

No loop que renderiza os `ProductCard` dentro do cardápio do cliente, adicionar a classe `u-stagger` e o delay via style inline nos primeiros 12 itens:

```tsx
{filteredProducts.map((product, index) => (
  <ProductCard
    key={product.id}
    product={product}
    className={index < 12 ? 'u-stagger' : ''}
    style={index < 12 ? { '--stagger': `${index * 30}ms` } as React.CSSProperties : undefined}
    // ... outras props existentes
  />
))}
```

Se o `ProductCard` não aceita `className` e `style` como props, envolver num `<div>`:
```tsx
{filteredProducts.map((product, index) => (
  <div
    key={product.id}
    className={index < 12 ? 'u-stagger' : ''}
    style={index < 12 ? { '--stagger': `${index * 30}ms` } as React.CSSProperties : undefined}
  >
    <ProductCard product={product} /* ... */ />
  </div>
))}
```

- [ ] **Step 2: Verificar**

Abrir o cardápio do cliente. Os primeiros cards devem aparecer com um leve efeito cascata (cada um 30ms depois do anterior). Acima de 12, aparecem todos juntos.

- [ ] **Step 3: Commit**

```bash
git add components/modules/ClientModule.tsx
git commit -m "feat: stagger nos ProductCards do cardápio (30ms × 12 itens)"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

### Task 11: Sidebar — pílula animada entre abas (verificação)

**Files:**
- Verify: `components/modules/StoreModule.tsx:1283-1286` (sidebar nav-ativo layoutId)

**Interfaces:**
- Consumes: `SPRING_UI` de `lib/motion.ts`, `layoutId` do Framer Motion
- Produces: confirmação de que a pílula animada já existe (implementada na Task 10 do redesign Apple)

- [ ] **Step 1: Verificar se já existe**

Run: `grep -n 'layoutId="nav-ativo"' ~/Projects/norte\ para\ negocios/ntb\ vendas/components/modules/StoreModule.tsx`
Expected: resultado encontrado (linha ~1283). Se existir, esta task já está feita — pular para o commit de verificação.

- [ ] **Step 2: Se não existir, implementar**

Se o `layoutId` não estiver presente, adicionar dentro do botão da sidebar, condicional ao item ativo:
```tsx
{currentTab === item.id && (
  <motion.div
    layoutId="nav-ativo"
    transition={SPRING_UI}
    className="absolute inset-0 -z-10 rounded-[10px] bg-white/[0.18] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
  />
)}
```

E garantir que `SPRING_UI` está importado de `@/lib/motion`.

- [ ] **Step 3: Verificar**

Abrir o painel do lojista. Clicar em abas diferentes na sidebar. A pílula branca deve deslizar suavemente entre os itens.

- [ ] **Step 4: Commit (só se houve mudança)**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat: sidebar — pílula animada entre abas (layoutId + SPRING_UI)"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

### Task 12: Typecheck final + testes existentes

**Files:**
- Nenhum arquivo modificado — verificação final

**Interfaces:**
- Consome: todas as mudanças das Tasks 1-11
- Produz: confirmação de que nada quebrou

- [ ] **Step 1: Typecheck completo**

Run: `cd ~/Projects/norte\ para\ negocios/ntb\ vendas && npx tsc --noEmit 2>&1 | tail -5`
Expected: zero erros.

- [ ] **Step 2: Rodar testes existentes**

Run: `cd ~/Projects/norte\ para\ negocios/ntb\ vendas && for t in scripts/testes/*.test.ts; do npx tsx $t 2>&1 | tail -1; done`
Expected: todos os testes passam (mesmo resultado de antes das mudanças).

- [ ] **Step 3: Build de produção**

Run: `cd ~/Projects/norte\ para\ negocios/ntb\ vendas && npm run build 2>&1 | tail -10`
Expected: build completa sem erros.

- [ ] **Step 4: Commit de verificação (se necessário)**

Se algum ajuste foi necessário durante a verificação:
```bash
git add -A
git commit -m "fix: ajustes pós-verificação do plano design/animação/ux"
```

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

---

## Resumo de Execução

| Task | Descrição | Tempo estimado | Arquivos |
|------|-----------|---------------|----------|
| 1 | Input com borda + dark mode --bg | 5 min | ui.tsx, globals.css |
| 2 | Touch targets críticos (select, chips, fechar) | 5 min | ClientModule.tsx |
| 3 | Haptic no "+" do ProductCard | 2 min | ClientModule.tsx |
| 4 | KDS transição de cor no status | 5 min | StoreModule.tsx |
| 5 | Badge com variantes semânticas | 10 min | ui.tsx |
| 6 | Token --r-xl + unificar raios | 10 min | globals.css, ui.tsx, page.tsx |
| 7 | ACTION_BG → token + sombras tokenizadas | 10 min | ClientModule.tsx, globals.css, ui.tsx, page.tsx |
| 8 | Banner offline no cardápio | 15 min | ClientModule.tsx |
| 9 | Feedback inline no PIN | 15 min | ClientModule.tsx |
| 10 | Stagger nos ProductCards | 10 min | ClientModule.tsx |
| 11 | Sidebar pílula animada (verificação) | 5 min | StoreModule.tsx |
| 12 | Typecheck + testes + build | 10 min | — |
| **Total** | | **~1h40min** | |

**Deploy:** após todas as tasks, `git push origin main` + `ssh root@185.193.66.240 "cd /opt/ntb-vendas && bash deploy.sh"` + bump desktop para 1.2.81 + bump Android para 1.0.17. Só com OK explícito do dono.