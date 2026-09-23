# Mobile — Fase 1: Base transversal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir, de uma vez pra todas as telas, os problemas de celular de maior impacto e menor risco: área segura do iPhone, altura correta da tela, aviso acima da barra inferior, janela virando folha de celular, teclado/zoom dos campos, alvos de toque de 44px e legibilidade da barra inferior.

**Architecture:** Só CSS/classes e pequenos ajustes em componentes compartilhados (`app/layout.tsx`, `components/ui.tsx`, `components/Toast.tsx`, `app/globals.css`) mais aplicação pontual nas telas de mais uso (`StoreModule.tsx`, `ClientModule.tsx`). Nenhuma mudança de dados, banco ou regra de negócio. Em telas ≥ `sm`/`md` (tablet/desktop) o comportamento atual é preservado.

**Tech Stack:** Next.js 16, React 19, Tailwind v4 (classes com valores arbitrários, ex. `pb-[env(safe-area-inset-bottom)]`), `motion`.

**Spec:** `docs/superpowers/specs/2026-09-23-mobile-overhaul-design.md` (§3 fase 1). Evidência: `~/ClaudeGerado/ntb-vendas-mobile-audit-2026-09-23/code-audit.md` (achados 2, 3, 4, 6, 7, 8, 9, 10).

## Global Constraints

- Telas `md` (≥768px) e `sm` (≥640px) NÃO podem mudar de aparência: toda regra nova de celular usa o padrão mobile-first (`classe-mobile sm:classe-antiga` / `md:classe-antiga`).
- Tailwind v4 com tokens CSS: usar `var(--token)`; nunca a variante `dark:`.
- Sem framework de teste no projeto: cada task verifica com `npx tsc --noEmit` e, na Task 7, com medições Playwright em viewport de celular contra o deploy.
- Trabalho direto na `main` (autorizado), commits pequenos, deploy só na Task 7 (uma subida).
- Commit termina com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Não mexer em: lógica de pedido/pagamento/fiscal, `lib/`, migrations, cores de marca.

## Review Focus

1. **Modal aninhado** (ex.: "Mesa X" abre "Receber Pagamento" que abre outro): a trava de scroll do `body` deve ser por contagem — fechar o de cima não pode liberar o scroll enquanto o de baixo segue aberto, e fechar todos deve restaurar o scroll (task 3).
2. **Tablet/desktop (≥640px)**: `Modal` continua centralizado com cantos arredondados e `max-h` antigo; nenhuma tela larga vira folha (task 3).
3. **Navegador sem `env(safe-area-inset-*)` ou sem `dvh`** (Chrome antigo/Android WebView): as regras precisam degradar pro valor de antes (usar `max(...)`/fallback), nunca ficar sem padding (tasks 1, 2, 3).
4. **Toast no cardápio do cliente** (sem barra inferior de lojista): o novo deslocamento não pode cobrir o botão fixo do carrinho nem sumir fora da tela (task 2).
5. **Alvo de 44px sem mudar o layout**: a área de toque ampliada não pode sobrepor o botão vizinho (ex.: lixeira colada ao valor) nem tornar clicável área fora do cartão pai (task 5).

---

### Task 1: Viewport, `dvh` e área segura no casco do painel

**Files:**
- Modify: `app/layout.tsx:26-28`
- Modify: `components/modules/StoreModule.tsx:800` (casco), `:1053` (barra inferior), `:11116` (login)
- Modify: `app/acesso/page.tsx:44`

**Interfaces:** Produz: `viewport.viewportFit = 'cover'` (todas as `env(safe-area-inset-*)` do app passam a valer).

- [ ] **Step 1: Ativar `viewport-fit=cover`**

Em `app/layout.tsx`, trocar:

```tsx
export const viewport: Viewport = {
  themeColor: '#484DB5',
};
```

por:

```tsx
export const viewport: Viewport = {
  themeColor: '#484DB5',
  // viewport-fit=cover: sem isso todo env(safe-area-inset-*) vale 0 e a barra
  // inferior/carrinho encostam no gesto de home do iPhone (auditoria 2026-09-23).
  viewportFit: 'cover',
};
```

- [ ] **Step 2: Casco do painel com `dvh` e folga da barra inferior**

Em `StoreModule.tsx:800`, na `className` do `<div>` raiz, trocar `min-h-screen` por `min-h-dvh` e `pb-20 md:pb-0` por `pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0`. Trecho resultante:

```tsx
<div className={`min-h-dvh bg-[var(--bg)] pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 transition-all duration-[var(--dur-slow)] ${isCollapsed ? 'md:pl-20' : 'md:pl-64'}`}>
```

- [ ] **Step 3: Barra inferior respeitando a área segura**

Em `StoreModule.tsx:1053`, trocar `pb-4` por `pb-[max(1rem,env(safe-area-inset-bottom))]` (o `max` mantém o valor antigo quando o aparelho não tem área segura):

```tsx
<div className="fixed bottom-0 left-0 w-full bg-[var(--ink)] border-t border-white/8 flex justify-around px-2 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden z-40">
```

- [ ] **Step 4: `dvh` nas telas de login**

Em `StoreModule.tsx:11116`: `min-h-screen` → `min-h-dvh` (mesma linha, mantendo as demais classes). Em `app/acesso/page.tsx:44`: `min-h-screen` → `min-h-dvh`.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit` — Expected: sem erros.
Run: `grep -n "min-h-screen" components/modules/StoreModule.tsx app/acesso/page.tsx` — Expected: nenhuma ocorrência nos 3 pontos alterados (outras telas ficam pra fases seguintes).

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx app/acesso/page.tsx components/modules/StoreModule.tsx
git commit -m "Mobile base: viewport-fit=cover, dvh e área segura no casco/barra inferior" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Toast e aviso acima da barra inferior

**Files:**
- Modify: `components/Toast.tsx:53`

**Interfaces:** Nenhuma nova. Consome o padrão de folga da Task 1 (barra inferior ≈ 4.5rem + área segura).

- [ ] **Step 1: Deslocar o contêiner do toast no celular**

Em `components/Toast.tsx`, na `className` do `<div role="status">`, trocar `fixed bottom-4 right-4` por `fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 md:bottom-4`. Resultado:

```tsx
className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 md:bottom-4 z-[100] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none"
```

Efeito: no celular o toast fica acima da barra inferior do painel (5 abas) e acima do botão fixo do carrinho do cliente; de `md` pra cima nada muda.

- [ ] **Step 2: Botão de fechar do toast com alvo maior**

No mesmo arquivo, o botão de fechar (`<X size={14} />`, ~14px) passa a ter área de toque de 44px sem mudar o desenho — trocar sua `className` para incluir `hit-44` (classe criada na Task 5; se a Task 5 ainda não foi feita, o botão do Toast é tratado na Task 5, Step 2 — pule este passo).

- [ ] **Step 3: Verificar e commitar**

Run: `npx tsc --noEmit` — Expected: sem erros.

```bash
git add components/Toast.tsx
git commit -m "Mobile base: toast acima da barra inferior no celular" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `Modal` vira folha de celular (com `dvh` e trava de scroll)

**Files:**
- Modify: `components/ui.tsx` — variante `center` (~linhas 405-445) e variante `sheet` (linha ~360 `max-h-[90vh]`); novo hook logo acima do `Modal` (~linha 147).

**Interfaces:** Produz: hook interno `useBodyScrollLock(active: boolean)` (por contagem, seguro para modais aninhados). A API pública do `Modal` (props) não muda.

- [ ] **Step 1: Hook de trava de scroll por contagem**

Em `components/ui.tsx`, imediatamente antes de `export const Modal`, adicionar (o arquivo já importa `useEffect`; conferir com `grep -n "^import" components/ui.tsx` e acrescentar `useEffect` ao import do React se faltar):

```tsx
// Trava o scroll do <body> enquanto houver algum modal aberto. Por contagem:
// modais aninhados (Mesa X → Receber Pagamento) só liberam o body quando o
// ÚLTIMO fecha.
let bodyScrollLocks = 0;
const useBodyScrollLock = (active: boolean) => {
  useEffect(() => {
    if (!active) return;
    if (bodyScrollLocks++ === 0) document.body.style.overflow = 'hidden';
    return () => {
      if (--bodyScrollLocks === 0) document.body.style.overflow = '';
    };
  }, [active]);
};
```

- [ ] **Step 2: Chamar o hook dentro do `Modal`**

Dentro do corpo de `Modal`, junto dos outros hooks (antes de qualquer `return`), adicionar: `useBodyScrollLock(isOpen);`

- [ ] **Step 3: Variante `center` como folha no celular**

Na variante `center` (a que renderiza `bg-black/40 backdrop-blur-[2px] p-4`):

1. Scrim: trocar `flex items-center justify-center ... p-4` por `flex items-end sm:items-center justify-center ... p-0 sm:p-4`:

```tsx
className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-0 sm:p-4"
```

2. Painel (`motion.div key="panel"`): trocar a `className` por:

```tsx
className={`w-full ${resolvedWidth} bg-[var(--surface)] rounded-t-[var(--r-lg)] sm:rounded-[var(--r-lg)] overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-none`}
```

3. Animação: no celular a folha sobe de baixo; manter a escala atual só em `sm+` não é possível por prop, então mantenha `initial/animate/exit` como estão (fade+escala leve) — não trocar por deslize nesta fase (evita regressão visual; deslize fica pra fase 4 com a folha do cliente).

4. Cabeçalho (`div className="flex items-center justify-between px-5 py-4 border-b ..."`): acrescentar `flex-shrink-0`.

5. Botão fechar: trocar `p-1` por `p-2.5 sm:p-1` e `<X size={16} />` por `<X size={18} />` (área de toque de 38px no celular; o cabeçalho tem folga).

6. Corpo: trocar

```tsx
<div className="p-5 max-h-[80vh] overflow-y-auto">{children}</div>
```

por

```tsx
<div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain min-h-0 sm:max-h-[80vh]">{children}</div>
```

(No celular a altura vem do `max-h-[92dvh]` do painel + `flex-col` + `min-h-0`; em `sm+` volta o `max-h-[80vh]` de antes.)

- [ ] **Step 4: Variante `sheet` com `dvh`**

Na variante `sheet` (linha ~360), trocar `max-h-[90vh]` por `max-h-[90dvh]`.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit` — Expected: sem erros.
Run: `grep -n "80vh\|90vh" components/ui.tsx` — Expected: só `sm:max-h-[80vh]` aparece (o `90vh` da sheet virou `90dvh`).

- [ ] **Step 6: Commit**

```bash
git add components/ui.tsx
git commit -m "Mobile base: Modal como folha no celular, dvh e trava de scroll por contagem" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Campos com 16px e teclado certo

**Files:**
- Modify: `components/ui.tsx:67` (`Input`)
- Modify: `components/modules/StoreModule.tsx:2062` (valor do pagamento), `:4262` e `:5461`, `:5530`, `:10900` (CPF/CNPJ); campos de dinheiro/quantidade em `:6410`, `:6741`, `:6886`, `:8179`, `:8182`, `:8198`, `:8432`, `:10209`, `:10213`
- Modify: `components/modules/ClientModule.tsx` (campo de busca do cardápio, `text-[15px]`)

- [ ] **Step 1: `Input` compartilhado com 16px no celular**

Em `components/ui.tsx:67`, na `className` do `<input>`, trocar `text-sm` por `text-base sm:text-sm`. (16px no celular impede o zoom automático do iOS ao focar; `sm+` mantém 14px.)

- [ ] **Step 2: Valor do pagamento com teclado decimal**

`StoreModule.tsx:2062` (o `<input type="number" ... text-lg>` do valor do pagamento): adicionar a prop `inputMode="decimal"` logo após `type="number"`. Repetir para os campos de dinheiro:
`:6410`, `:6741`, `:6886` (valores de caixa/sangria/suprimento — conferir com `sed -n '<linha>,+6p'` que o rótulo é valor em R$), `:8179` (Preço), `:8182` (Preço promocional), `:8432` (+R$ da opção), `:10209`/`:10213` (filtro de total mínimo/máximo). Para campos inteiros (`:8198` tempo de preparo, `:8408`/`:8410` mínimo/máximo, séries fiscais `:9925…9981`, `:10199`/`:10203`): `inputMode="numeric"`.

- [ ] **Step 3: CPF/CNPJ com teclado numérico**

Nos 4 campos com `placeholder="CPF ou CNPJ do cliente"` (`StoreModule.tsx:4262`, `:5461`, `:5530`, `:10900`): acrescentar `inputMode="numeric"` e `autoComplete="off"`, e trocar `text-sm` por `text-base sm:text-sm` na `className` (são `<input>` cru, não usam o `Input` compartilhado).

- [ ] **Step 4: Busca do cliente com 16px**

Em `ClientModule.tsx`, o `<input>` da busca do cardápio (buscar `placeholder={\`Buscar em`): trocar `text-[15px]` por `text-base`.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit` — Expected: sem erros.
Run: `grep -c 'inputMode=' components/modules/StoreModule.tsx` — Expected: ≥ 20 (antes: 1).
Run: `grep -n 'placeholder="CPF ou CNPJ do cliente"' -B4 components/modules/StoreModule.tsx | grep -c 'inputMode="numeric"'` — Expected: 4.

- [ ] **Step 6: Commit**

```bash
git add components/ui.tsx components/modules/StoreModule.tsx components/modules/ClientModule.tsx
git commit -m "Mobile base: inputs 16px (sem zoom do iOS) e inputMode em valor/CPF/números" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Alvos de toque de 44px sem mudar o desenho

**Files:**
- Modify: `app/globals.css` (nova classe `.hit-44`)
- Modify: `components/modules/StoreModule.tsx:3670-3684` (olho do PIN), `:3698-3704` (cadeado), `:3768-3772` (Atender garçom), `:4134-4141` (lixeira da comanda), `:1594-1602` (quantidade do garçom), `:2116-2120` (remover pagamento), `:2043` (bandeiras)
- Modify: `components/modules/ClientModule.tsx:1166` ("+" rápido do produto)
- Modify: `components/Toast.tsx` (botão fechar)

**Interfaces:** Produz: classe utilitária global `hit-44` (amplia a área clicável do elemento para no mínimo 44x44px, centrada, sem alterar layout).

- [ ] **Step 1: Criar a classe `hit-44`**

No fim de `app/globals.css` adicionar:

```css
/* Área de toque mínima de 44x44px sem mudar o desenho: um pseudo-elemento
   invisível centrado no elemento. Só amplia quando o elemento é menor que 44px. */
.hit-44 { position: relative; }
.hit-44::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: max(100%, 44px);
  height: max(100%, 44px);
  transform: translate(-50%, -50%);
}
```

- [ ] **Step 2: Aplicar nos controles da lista (acrescentar `hit-44` à `className` existente de cada botão)**

| Arquivo:linha | Controle |
|---|---|
| `StoreModule.tsx:3676` | olho do PIN da mesa (`togglePin`) |
| `StoreModule.tsx:~3700` | cadeado bloquear/desbloquear mesa |
| `StoreModule.tsx:~3770` | botão "ATENDER GARÇOM" (também trocar `h-8` por `min-h-11` para a altura real) |
| `StoreModule.tsx:4134` | lixeira "Cancelar item" da comanda |
| `StoreModule.tsx:1596` e `:1598` | `−` e `+` da quantidade no modal do garçom |
| `StoreModule.tsx:2118` | lixeira "remover pagamento lançado" |
| `ClientModule.tsx:1166` | botão "+" do produto (visual 28px, toque 44px) |
| `Toast.tsx` | botão `X` de fechar do toast |

Para conferir cada linha antes de editar: `sed -n '<linha>,+3p' <arquivo>`. Não alterar o restante das classes (o desenho fica igual).

- [ ] **Step 3: Botões de bandeira e abas do pagamento**

`StoreModule.tsx:2043` (botões Visa/Mastercard/…): `py-2` → `py-3`. Abas de forma de pagamento (`:4198-4212`): `py-1.5 text-xs` → `py-2.5 text-[13px]`.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` — Expected: sem erros.
Run: `grep -c "hit-44" components/modules/StoreModule.tsx components/modules/ClientModule.tsx components/Toast.tsx` — Expected: StoreModule ≥ 6, ClientModule ≥ 1, Toast ≥ 1.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css components/modules/StoreModule.tsx components/modules/ClientModule.tsx components/Toast.tsx
git commit -m "Mobile base: área de toque de 44px (hit-44) nos controles pequenos de maior uso" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Barra inferior legível

**Files:**
- Modify: `components/modules/StoreModule.tsx:1054` (botão da aba) e o `<span>` do rótulo (`:1063-1070`)

- [ ] **Step 1: Rótulo 11px e contraste da aba inativa**

Na `className` do botão de cada aba (linha 1054): `text-[10px]` → `text-[11px]` e `text-white/40` → `text-white/65`:

```tsx
className={`relative flex flex-col items-center gap-1 text-[11px] font-medium px-3 py-1.5 rounded-[var(--r-md)] u-motion ${currentTab === item.id ? 'text-white' : 'text-white/65'}`}
```

- [ ] **Step 2: Rótulo sem corte fixo de 56px**

No `<span className="truncate max-w-[56px] text-center">` trocar `max-w-[56px]` por `max-w-[72px]` (rótulos como "Balcão"/"Cozinha" cabem inteiros em 360px com 5 abas).

- [ ] **Step 3: Verificar e commitar**

Run: `npx tsc --noEmit` — Expected: sem erros.

```bash
git add components/modules/StoreModule.tsx
git commit -m "Mobile base: barra inferior com rótulo 11px e contraste AA" \
  -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Deploy e verificação ao vivo em celular

**Files:** nenhum no repo (scripts e capturas ficam no scratchpad da sessão).

- [ ] **Step 1: Build local**

Run: `npm run build` — Expected: build limpo, mesmas rotas de antes.

- [ ] **Step 2: Deploy**

```bash
git push
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-vendas/deploy.sh > /tmp/deploy.log 2>&1; tail -1 /tmp/deploy.log"
```

Expected: `✓ Ready in …ms` (o deploy pode passar de 2 min; usar `timeout` alto / segundo plano).

- [ ] **Step 3: Medições com Playwright (390x844, isMobile, hasTouch, `zz-laboratorio`)**

Login pela conta universal (credenciais lidas do servidor sem imprimir; apagar o arquivo depois) e, no scratchpad, um script que verifica:

1. `document.querySelector('meta[name=viewport]').content` contém `viewport-fit=cover`.
2. Na barra inferior: `getComputedStyle(nav).paddingBottom` ≥ 16px.
3. Disparar um toast (ex.: abrir Cardápio → ação inócua que gere toast, ou `window.dispatchEvent` do mecanismo do toast se existir) e conferir que `toast.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top` (toast NÃO cobre a barra).
4. Abrir o modal "Categorias" do Cardápio: `panel.getBoundingClientRect().bottom === innerHeight` (folha colada embaixo) e cantos superiores arredondados; em viewport 1024x768 o mesmo modal continua centralizado (`bottom < innerHeight`).
5. Com o modal aberto: `getComputedStyle(document.body).overflow === 'hidden'`; fechado: `''`. Abrir dois modais aninhados (Mesa → Receber Pagamento na loja de teste, ou dois modais do Cardápio) e fechar só o de cima: `overflow` continua `hidden`.
6. `getComputedStyle(input).fontSize === '16px'` para o campo de busca do Cardápio e para o CPF do pagamento.
7. Alvo de toque: para o "+" do cliente (`/c/zz-laboratorio`), `page.mouse.click(cx + 20, cy)` (20px do centro, fora do botão de 28px) dispara a ação (item abre o modal/adiciona).
8. Rótulos da barra inferior: `fontSize === '11px'` e `cor` com opacidade 0.65 nas abas inativas.

- [ ] **Step 4: Capturas de conferência**

Tirar 6 capturas (Mesas, Caixa, modal Categorias, modal do produto, cardápio do cliente, Administração) em 390x844 e 360x740 e olhar cada uma (nada cortado, barra inferior íntegra, sem faixa vazia).

- [ ] **Step 5: Publicar o app desktop**

Bump de patch em `desktop/package.json`, `cd desktop && npm run dist && bash scripts/publish.sh`, commit do bump e `git push`.

- [ ] **Step 6: Registrar**

Atualizar a memória do projeto (`project_ntb_vendas_mobile_figma.md`): fase 1 concluída, próximos = plano da fase 2.

---

## Self-Review

**Cobertura da spec (§3, fase 1):** viewport/safe-area/dvh → Task 1; toast e barra → Tasks 1–2; Modal como folha → Task 3; inputs 16px + inputMode → Task 4; alvos de 44px → Task 5; legibilidade da barra inferior → Task 6; verificação ao vivo → Task 7. Fases 2–6 não fazem parte deste plano por decisão da spec (cada uma ganha plano próprio quando a anterior fechar).

**Placeholders:** nenhum. Linhas marcadas com `~` (Tasks 5 e 4) têm o comando `sed -n` de conferência no próprio passo, porque as linhas se deslocam a cada commit no arquivo de ~11k linhas.

**Consistência:** `hit-44` é definida na Task 5 e referenciada na Task 2 (Step 2 remete à Task 5, Step 2). `useBodyScrollLock` só é usado dentro de `Modal`. A folga de 5rem/5.5rem da barra inferior é a mesma nas Tasks 1 e 2.
