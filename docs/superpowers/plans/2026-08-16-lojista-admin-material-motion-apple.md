# Lojista + Admin: material de vidro + motion Apple — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender pro painel do lojista (`StoreModule.tsx`) e Master Admin (`AdminModule.tsx`) o mesmo sistema de motion "Apple liquid glass" (springs, vidro, acordeão) já validado e em produção no cardápio do cliente (`ClientModule.tsx`).

**Architecture:** Fundação primeiro — promove `SPRING_TAP`/`SPRING_SHEET` pra um módulo compartilhado (`lib/motion.ts`) e faz `Button`/`Card`/`Modal` (compartilhados, `components/ui.tsx`) usarem física de mola de verdade em vez de CSS, mais um novo primitivo `Collapsible`. Depois, uma task por área de tela do lojista/admin, todas herdando a fundação de graça.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, lib `motion` (já instalada), Tailwind v4 + CSS custom properties existentes.

**Spec:** `docs/superpowers/specs/2026-08-16-lojista-admin-material-motion-apple.md`

## Global Constraints

- Todo spring novo usa as constantes `SPRING_TAP`/`SPRING_SHEET` de `lib/motion.ts` (Task 1) — nunca `duration` com easing CSS craft nem stiffness/damping ad-hoc.
- Vidro (`backdrop-filter`, classe `.u-glass`) só em elementos fixos/sticky/modal — nunca em algo que rola junto com a página.
- `Card` (`components/ui.tsx`) só recebe motion hover/tap quando `hoverable` ou `onClick` já está setado (mesma condição que hoje ativa `cursor-pointer u-card`) — produtos/categorias arrastáveis via `react-beautiful-dnd` em `MenuManagementView` NÃO passam nenhuma das duas props, então ficam automaticamente de fora e não têm conflito de `transform` com o `provided.draggableProps.style` do dnd. Não adicionar `hoverable`/`onClick` a esses cards nesta rodada.
- Depois de cada task: `npx tsc --noEmit` e `npm run build` limpos antes de commitar (projeto não tem suite automatizada — QA real é visual, `npm run dev` + captura de tela).
- Testar sempre contra loja de teste (Bistrô Demo / Vieras e Vinhos) no `testvendase` — nunca loja real de cliente.
- Screenshot pro usuário ao fim de cada task com mudança visual perceptível.

---

### Task 1: Fundação — `lib/motion.ts`, `Button`/`Card`/`Modal` com spring, `Collapsible`

**Files:**
- Create: `lib/motion.ts`
- Modify: `components/modules/ClientModule.tsx` (import de `SPRING_TAP`/`SPRING_SHEET`)
- Modify: `components/ui.tsx` (`Button`, `Card`, `Modal` variant `'center'`, novo `Collapsible`)

**Interfaces:**
- Produces: `SPRING_TAP`, `SPRING_SHEET` (constantes de transição `motion`, `lib/motion.ts`); `Collapsible` — `{ title: string; defaultOpen?: boolean; badge?: React.ReactNode; children: React.ReactNode }`, exportado de `components/ui.tsx`.
- Consumes: nada (task raiz).

- [ ] **Step 1: Criar `lib/motion.ts`**

```tsx
// Presets de spring validados com o usuário no companion visual de
// brainstorming (2026-08-16, cardápio do cliente) e agora compartilhados
// com o resto do app (lojista/admin, 2026-08-16). Não são valores
// arbitrários — não criar um terceiro preset sem passar pelo mesmo
// processo de validação visual.
// SPRING_TAP: feedback de toque, sem bounce (damping 1.0 da Apple — botão
// não carrega momentum de gesto).
// SPRING_SHEET: abrir/fechar/arrastar de folha e acordeão, bounce leve
// (~damping 0.82, bate com o valor que a Apple documenta pra drawer/sheet).
export const SPRING_TAP = { type: 'spring' as const, bounce: 0, duration: 0.15 };
export const SPRING_SHEET = { type: 'spring' as const, bounce: 0.18, duration: 0.4 };
```

- [ ] **Step 2: `ClientModule.tsx` passa a importar de `lib/motion.ts`**

Achar (topo do arquivo, perto de `WINE_GOLD_DARK`):
```tsx
const SPRING_TAP = { type: 'spring' as const, bounce: 0, duration: 0.15 };
const SPRING_SHEET = { type: 'spring' as const, bounce: 0.18, duration: 0.4 };
```
Remover essas duas linhas (e o bloco de comentário logo acima delas) e adicionar no topo do arquivo, junto aos outros imports:
```tsx
import { SPRING_TAP, SPRING_SHEET } from '@/lib/motion';
```
Nenhuma outra linha de `ClientModule.tsx` muda — é troca de definição local por import, os usos (`transition={SPRING_TAP}` etc.) continuam idênticos.

- [ ] **Step 3: Verificar que o cardápio não quebrou**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit
```
Esperado: limpo (nenhuma referência quebrada a `SPRING_TAP`/`SPRING_SHEET`).

- [ ] **Step 4: `Button` vira `motion.button` com spring de verdade**

Em `components/ui.tsx`, adicionar o import no topo:
```tsx
import { SPRING_TAP } from '@/lib/motion';
```

Achar a definição completa de `Button` (hoje):
```tsx
export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    isLoading?: boolean;
  }
> = ({ className = '', variant = 'primary', size = 'md', isLoading, children, ...props }) => {
  const base =
    'inline-flex items-center justify-center font-medium rounded-[var(--r-md)] u-motion u-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none select-none';

  const sizes = {
    sm: 'px-3 py-1.5 text-[13px] gap-1.5',
    md: 'px-4 py-2 text-[14px] gap-2',
    lg: 'px-5 py-2.5 text-[15px] gap-2',
  };

  const variants = {
    primary:
      'bg-[var(--brand)] hover:bg-[var(--brand-strong)] text-white focus-visible:ring-[var(--brand)] shadow-sm',
    secondary:
      'bg-[var(--surface-2)] hover:bg-[var(--border)] text-[var(--text)] focus-visible:ring-[var(--brand)]',
    outline:
      'border border-[var(--border)] hover:border-[var(--brand)] text-[var(--text)] hover:text-[var(--brand)] focus-visible:ring-[var(--brand)]',
    danger:
      'bg-[var(--err)] hover:opacity-90 text-white focus-visible:ring-[var(--err)]',
    ghost:
      'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:ring-[var(--brand)]',
  };

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
};
```

Trocar por (mesmas classes/props, só o elemento raiz vira `motion.button` com `whileTap`/`whileHover` — CSS `u-press` sai da lista de classes porque o spring de verdade substitui o `:active{scale}`, `u-motion` fica pra cobrir color/background/shadow que não são spring; `disabled` já bloqueia `whileTap`/`whileHover` nativamente no Motion quando o elemento está `disabled`, sem precisar de lógica extra):

```tsx
export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    isLoading?: boolean;
  }
> = ({ className = '', variant = 'primary', size = 'md', isLoading, children, ...props }) => {
  const base =
    'inline-flex items-center justify-center font-medium rounded-[var(--r-md)] u-motion focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none select-none';

  const sizes = {
    sm: 'px-3 py-1.5 text-[13px] gap-1.5',
    md: 'px-4 py-2 text-[14px] gap-2',
    lg: 'px-5 py-2.5 text-[15px] gap-2',
  };

  const variants = {
    primary:
      'bg-[var(--brand)] hover:bg-[var(--brand-strong)] text-white focus-visible:ring-[var(--brand)] shadow-sm',
    secondary:
      'bg-[var(--surface-2)] hover:bg-[var(--border)] text-[var(--text)] focus-visible:ring-[var(--brand)]',
    outline:
      'border border-[var(--border)] hover:border-[var(--brand)] text-[var(--text)] hover:text-[var(--brand)] focus-visible:ring-[var(--brand)]',
    danger:
      'bg-[var(--err)] hover:opacity-90 text-white focus-visible:ring-[var(--err)]',
    ghost:
      'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:ring-[var(--brand)]',
  };

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      whileHover={{ scale: 1.015 }}
      transition={SPRING_TAP}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </motion.button>
  );
};
```

(`motion` já está importado em `components/ui.tsx` desde a rodada do cardápio — `import { motion, AnimatePresence } from 'motion/react';` no topo do arquivo.)

- [ ] **Step 5: `Card` ganha hover com spring, só quando `hoverable`/`onClick`**

Achar a definição completa de `Card` (hoje):
```tsx
export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
  accentColor?: string;
  style?: React.CSSProperties;
}> = ({ children, className = '', onClick, hoverable, accentColor, style }) => (
  <div
    onClick={onClick}
    className={`relative overflow-hidden rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] ${
      onClick || hoverable ? 'cursor-pointer u-card' : ''
    } ${className}`}
    style={{ boxShadow: 'var(--shadow-sm)', ...style }}
  >
    {accentColor && (
      <div className="absolute inset-y-0 left-0 w-1 rounded-l-[var(--r-lg)]" style={{ backgroundColor: accentColor }} />
    )}
    {children}
  </div>
);
```

Trocar por (a `div` raiz vira `motion.div`; `whileHover`/`whileTap` só entram nas props quando `onClick || hoverable` — via spread condicional, pra nenhum card "mudo" ganhar comportamento de toque sem pedir):

```tsx
export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
  accentColor?: string;
  style?: React.CSSProperties;
}> = ({ children, className = '', onClick, hoverable, accentColor, style }) => {
  const interactive = Boolean(onClick || hoverable);
  return (
    <motion.div
      onClick={onClick}
      {...(interactive
        ? { whileHover: { y: -2, boxShadow: 'var(--shadow-md)' }, whileTap: { scale: 0.99 }, transition: SPRING_TAP }
        : {})}
      className={`relative overflow-hidden rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] ${
        interactive ? 'cursor-pointer' : ''
      } ${className}`}
      style={{ boxShadow: 'var(--shadow-sm)', ...style }}
    >
      {accentColor && (
        <div className="absolute inset-y-0 left-0 w-1 rounded-l-[var(--r-lg)]" style={{ backgroundColor: accentColor }} />
      )}
      {children}
    </motion.div>
  );
};
```

(a classe `u-card` some da condição — ela hoje só faz `transition-property` CSS pra `box-shadow, transform, border-color`, redundante com o `whileHover` novo; mantém no restante do app quem ainda usa `u-card` fora deste componente, aqui só não é mais necessária.)

- [ ] **Step 6: `Modal` variant `'center'` ganha spring**

Em `components/ui.tsx`, adicionar ao import já existente:
```tsx
import { SPRING_TAP, SPRING_SHEET } from '@/lib/motion';
```
(troca o `import { SPRING_TAP } from '@/lib/motion';` do Step 4 por essa linha com os dois nomes — um import só.)

Achar, no fim do componente `Modal` (o caminho `variant === 'center'`, depois do bloco `if (variant === 'sheet') { ... }`):
```tsx
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 animate-[fadeIn_0.2s_ease-out]">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${width} bg-[var(--surface)] rounded-[var(--r-lg)] overflow-hidden animate-[slideUp_0.25s_cubic-bezier(0.22,1,0.36,1)]`}
        style={{ boxShadow: 'var(--shadow-md), 0 0 0 1px var(--border)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 id={titleId} className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] p-1 rounded-[var(--r-sm)] u-motion"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};
```

Trocar por (mesmo scrim, mesmo layout — `AnimatePresence` precisa envolver pra ter saída animada, já que agora o `unmount` (`!isOpen`) precisa esperar o `exit` rodar; scrim e folha viram `motion.div` com fade+scale no lugar dos `animate-[...]` CSS):

```tsx
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
        >
          <motion.div
            key="panel"
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={SPRING_SHEET}
            className={`w-full ${width} bg-[var(--surface)] rounded-[var(--r-lg)] overflow-hidden`}
            style={{ boxShadow: 'var(--shadow-md), 0 0 0 1px var(--border)' }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 id={titleId} className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>
              <button
                onClick={onClose}
                className="text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] p-1 rounded-[var(--r-sm)] u-motion"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 max-h-[80vh] overflow-y-auto">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
```

Remover a linha `if (!isOpen) return null;` que ficava logo acima do bloco antigo — o `isOpen` agora é checado dentro do `AnimatePresence` (`{isOpen && (...)}`), igual ao caminho `variant === 'sheet'` já faz.

- [ ] **Step 7: Novo primitivo `Collapsible`**

Adicionar em `components/ui.tsx`, logo depois da definição de `Card` (antes de `Modal`):

```tsx
// Acordeão reutilizável (2026-08-16) — generaliza o padrão já validado no
// cardápio do cliente (acordeão de categoria, ClientModule.tsx) pra
// qualquer seção do lojista/admin que hoje é sempre visível e devia ficar
// recolhida por padrão. Ver docs/superpowers/specs/2026-08-16-lojista-
// admin-material-motion-apple.md.
export const Collapsible: React.FC<{
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, defaultOpen = false, badge, children }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        whileTap={{ scale: 0.99 }}
        transition={SPRING_TAP}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left u-motion hover:bg-[var(--surface-2)]"
      >
        <span className="flex items-center gap-2 font-bold text-[var(--text)]">
          {title}
          {badge}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING_SHEET} className="text-[var(--text-muted)] flex-shrink-0">
          <ChevronDown size={18} />
        </motion.span>
      </motion.button>
      <motion.div initial={false} animate={{ height: open ? 'auto' : 0 }} transition={SPRING_SHEET} style={{ overflow: 'hidden' }} aria-hidden={!open}>
        <div style={{ pointerEvents: open ? 'auto' : 'none' }} className="px-5 pb-5 pt-1 border-t border-[var(--border)]">
          {children}
        </div>
      </motion.div>
    </div>
  );
};
```

Adicionar `ChevronDown` ao import de `lucide-react` já existente no topo de `components/ui.tsx` (hoje só importa `Loader2, X`):
```tsx
import { Loader2, X, ChevronDown } from 'lucide-react';
```

- [ ] **Step 8: Typecheck + build**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit && npm run build
```
Esperado: limpo. Se `npm run build` reclamar de `React.useState`/`React.useId` sem `React` importado por completo em `ui.tsx` — conferir que o arquivo já importa `import React from 'react';` no topo (já importa, usado por `React.useRef`/`React.useEffect`/`React.useId` no `Modal` existente).

- [ ] **Step 9: Verificação visual rápida — nada quebrou**

```bash
npm run dev
```
Abrir `/painel` e `/loja` (login universal), clicar em qualquer botão e qualquer modal existente (ex.: "Nova Loja" no Admin) — confirmar que abre/fecha suave (com spring, não mais instantâneo), botões têm leve "encolhida" ao clicar. Abrir o cardápio do cliente (`/c/<slug>`) e confirmar que continua idêntico (o `ProductModal`/`BillSplitter` usam `variant='sheet'`, não tocado nesta task).

- [ ] **Step 10: Commit**

```bash
git add lib/motion.ts components/ui.tsx components/modules/ClientModule.tsx
git commit -m "feat(ui): fundação de motion compartilhada — Button/Card/Modal com spring, Collapsible novo"
```

---

### Task 2: Notas Fiscais — acordeão no cadastro, histórico primeiro

**Files:**
- Modify: `components/modules/StoreModule.tsx`

**Interfaces:**
- Consumes: `Collapsible` (Task 1, `components/ui.tsx`).

- [ ] **Step 1: Adicionar `Collapsible` ao import de `components/ui.tsx` em `StoreModule.tsx`**

Achar o import existente de `components/ui.tsx` no topo do arquivo (algo como `import { Card, Button, Modal, Badge, ... } from '@/components/ui';`) e adicionar `Collapsible` à lista.

- [ ] **Step 2: Envolver a seção "Certificado e Configuração Fiscal" em `Collapsible`, fechada por padrão**

Dentro de `StoreAdminView`, achar a abertura da seção:
```tsx
            <section className="bg-[var(--surface)] p-6 rounded-xl border border-[var(--border)] shadow-sm space-y-6">
                <h3 className="font-bold text-lg text-[var(--text)]">Certificado e Configuração Fiscal</h3>
```
e o fechamento correspondente, mais abaixo:
```tsx
            </section>
                    <FiscalNotasView storeId={storeId} />
```

Trocar as DUAS pontas: a abertura `<section ...><h3 ...>Certificado e Configuração Fiscal</h3>` vira `<Collapsible title="Certificado e Configuração Fiscal" defaultOpen={false}>` (sem o `<h3>` — o título agora é a prop `title` do `Collapsible`, que já renderiza como cabeçalho clicável), e o fechamento `</section>` vira `</Collapsible>`. O conteúdo interno inteiro (upload de certificado, todos os campos de configuração do emissor) fica **exatamente como está**, só perde o wrapper `<section>`/`<h3>` de fora.

- [ ] **Step 3: `FiscalNotasView` (histórico) passa a vir ANTES do `Collapsible`**

Achar a ordem atual (depois da troca do Step 2):
```tsx
            <Collapsible title="Certificado e Configuração Fiscal" defaultOpen={false}>
                {/* ...conteúdo do certificado/config... */}
            </Collapsible>
                    <FiscalNotasView storeId={storeId} />
```
Trocar a ORDEM (histórico primeiro, cadastro depois):
```tsx
            <FiscalNotasView storeId={storeId} />
            <Collapsible title="Certificado e Configuração Fiscal" defaultOpen={false}>
                {/* ...conteúdo do certificado/config... */}
            </Collapsible>
```

- [ ] **Step 4: Verificar visualmente**

```bash
npm run dev
```
Login universal, abrir `/loja`, ir na aba "Administração" → "Notas Fiscais" (nome exato da aba pode variar, é a que renderiza `StoreAdminView`). Confirmar: o histórico de notas aparece primeiro, o card "Certificado e Configuração Fiscal" vem depois, RECOLHIDO por padrão, com chevron; clicar no cabeçalho expande com o mesmo bounce do acordeão de categoria do cardápio. Testar salvar uma config com o acordeão aberto — confirmar que nada quebrou no formulário.

- [ ] **Step 5: Typecheck + build + commit**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit && npm run build
git add components/modules/StoreModule.tsx
git commit -m "feat(lojista): Notas Fiscais — cadastro em acordeão colapsado, histórico primeiro"
```

**Screenshot pro usuário:** acordeão fechado (histórico em destaque) e acordeão aberto.

---

### Task 3: Admin geral — mesmo acordeão no form de loja (`AdminModule.tsx`)

**Files:**
- Modify: `components/modules/AdminModule.tsx`

**Interfaces:**
- Consumes: `Collapsible` (Task 1).

- [ ] **Step 1: Adicionar `Collapsible` ao import de `components/ui.tsx`**

Mesmo padrão do Task 2, Step 1, no import já existente no topo de `AdminModule.tsx`.

- [ ] **Step 2: Envolver Certificado + Configuração do Emissor em `Collapsible`**

Dentro do form de loja (bloco `{editingId && (<> ... </>)}`), achar:
```tsx
              {editingId && (
                  <>
                      <div className="space-y-3">
                          <div className="flex items-center justify-between">
                              <label className="text-sm font-semibold text-[var(--text)] flex items-center gap-2"><Lock size={14}/> Certificado Digital (fiscal)</label>
                              {certBadge()}
                          </div>
```
e o fechamento do bloco de configuração do emissor mais abaixo (o `</>` que fecha o `{editingId && (<> ... </>)}`).

Trocar por: manter `{editingId && (` e o `<Lock size={14}/> Certificado Digital (fiscal)` + `{certBadge()}` como o `badge`/conteúdo do `Collapsible` (o badge de status do certificado é útil ver mesmo com o acordeão fechado — passar como prop `badge`):
```tsx
              {editingId && (
                  <Collapsible title="Certificado e Configuração Fiscal" defaultOpen={false} badge={certBadge()}>
                      <div className="space-y-3">
```
e trocar o `</>` de fechamento por `</Collapsible>`. O `<div className="space-y-3">`/label "Certificado Digital (fiscal)" interno junto com todo o resto (upload, `Input`s de validade/senha, botão "Salvar Certificado", o `<hr>`, e a seção inteira "Configuração do Emissor") continuam **exatamente como estão**, só um nível a menos de wrapper externo.

- [ ] **Step 3: Botões de ação do card de loja ganham feedback de toque com spring**

O card de cada loja na lista (`stores.map`, view `'stores'`) não é clicável como um todo — só os botões internos são ("Ver Cardápio", "Duplicar", "Editar", "Excluir"). Por isso o card em si NÃO ganha `hoverable`/`onClick` (isso faria o cursor virar "pointer" sobre uma área que não faz nada ao clicar, um sinal enganoso) — em vez disso, esses 4 botões (hoje CSS puro `u-motion u-press`) ganham o mesmo `whileTap`/`transition={SPRING_TAP}` que o `Button` compartilhado ganhou na Task 1.

Adicionar o import (se ainda não estiver presente nesse arquivo):
```tsx
import { motion } from 'motion/react';
import { SPRING_TAP } from '@/lib/motion';
```

Achar:
```tsx
                    <div className="mt-auto pt-4 flex gap-2 border-t border-[var(--border)]">
                        <a href={`/c/${store.slug}`} target="_blank" rel="noreferrer" className="flex-1 text-center py-2 text-sm font-medium text-[var(--brand)] hover:bg-[var(--brand)]/5 rounded-lg border border-[var(--brand)]/20 transition-colors">
                            Ver Cardápio
                        </a>
                        <button
                            onClick={() => handleDuplicateStore(store.id, store.name)}
                            className="px-3 text-[var(--text-muted)] hover:text-[var(--info)] u-motion u-press"
                            title="Duplicar"
                        >
                            <Copy size={18} />
                        </button>
                        <button
                            onClick={() => handleEditStore(store)}
                            className="px-3 text-[var(--text-muted)] hover:text-[var(--text)] u-motion u-press"
                            title="Editar"
                        >
                            <Edit2 size={18} />
                        </button>
                        <button
                            onClick={() => handleDeleteStore(store.id, store.name)}
                            className="px-3 text-[var(--text-muted)] hover:text-[var(--err)] u-motion u-press"
                            title="Excluir"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
```
Trocar por (`<a>`/`<button>` viram `motion.a`/`motion.button`, `u-press` sai — mesmo raciocínio da Task 1 — `whileTap` cobre o feedback):
```tsx
                    <div className="mt-auto pt-4 flex gap-2 border-t border-[var(--border)]">
                        <motion.a
                            whileTap={{ scale: 0.96 }}
                            transition={SPRING_TAP}
                            href={`/c/${store.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 text-center py-2 text-sm font-medium text-[var(--brand)] hover:bg-[var(--brand)]/5 rounded-lg border border-[var(--brand)]/20 transition-colors"
                        >
                            Ver Cardápio
                        </motion.a>
                        <motion.button
                            whileTap={{ scale: 0.9 }}
                            transition={SPRING_TAP}
                            onClick={() => handleDuplicateStore(store.id, store.name)}
                            className="px-3 text-[var(--text-muted)] hover:text-[var(--info)] u-motion"
                            title="Duplicar"
                        >
                            <Copy size={18} />
                        </motion.button>
                        <motion.button
                            whileTap={{ scale: 0.9 }}
                            transition={SPRING_TAP}
                            onClick={() => handleEditStore(store)}
                            className="px-3 text-[var(--text-muted)] hover:text-[var(--text)] u-motion"
                            title="Editar"
                        >
                            <Edit2 size={18} />
                        </motion.button>
                        <motion.button
                            whileTap={{ scale: 0.9 }}
                            transition={SPRING_TAP}
                            onClick={() => handleDeleteStore(store.id, store.name)}
                            className="px-3 text-[var(--text-muted)] hover:text-[var(--err)] u-motion"
                            title="Excluir"
                        >
                            <Trash2 size={18} />
                        </motion.button>
                    </div>
```

- [ ] **Step 4: Verificar visualmente**

```bash
npm run dev
```
Login universal, `/painel`, editar uma loja de teste, abrir o modal de edição — confirmar que "Certificado e Configuração Fiscal" aparece como acordeão fechado (com o badge de status do certificado visível mesmo fechado), expande ao clicar, formulário continua salvando normalmente. Na lista de lojas, clicar nos ícones "Duplicar"/"Editar"/"Excluir" — confirmar o encolhida de toque; o card em si não deve parecer clicável (sem cursor de mão fora dos botões).

- [ ] **Step 5: Typecheck + build + commit**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit && npm run build
git add components/modules/AdminModule.tsx
git commit -m "feat(admin): Certificado e Configuração Fiscal em acordeão; spring nos botões do card de loja"
```

**Screenshot pro usuário:** modal de edição de loja com o acordeão fechado.

---

### Task 4: Cardápio-admin — acordeão na integração NTB Estoque

**Files:**
- Modify: `components/modules/StoreModule.tsx`

**Interfaces:**
- Consumes: `Collapsible` (Task 1).

- [ ] **Step 1: Envolver a seção "Integração com o NTB Estoque" em `Collapsible`**

Dentro de `MenuManagementView`, achar:
```tsx
                    <h3 className="font-bold text-lg text-[var(--text)]">Integração com o NTB Estoque</h3>
```
e o container que a envolve (`<section>`/`<div>` correspondente logo acima desse `<h3>`) e o fechamento dele mais abaixo (depois do botão "Salvar Integração com o NTB Estoque"). Aplicar o mesmo padrão dos Tasks 2/3: trocar a abertura do container + `<h3>` por `<Collapsible title="Integração com o NTB Estoque" defaultOpen={false} badge={ntbEstoqueStatus.configurado ? <Badge color="bg-[var(--ok)]/10 border border-[var(--ok)]/30 text-[var(--ok)]">Configurado</Badge> : undefined}>`, e o fechamento pelo `</Collapsible>` correspondente. Conteúdo interno (status, inputs de URL/chave, toggle ativo/inativo, botão salvar) fica idêntico.

- [ ] **Step 2: Confirmar que os cards de produto/categoria (drag-and-drop) NÃO foram tocados**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
grep -n "hoverable\|onClick={.*setSelectedTable\|<Card className={\`flex gap-3 p-3" components/modules/StoreModule.tsx | grep -n "Draggable" 
```
Não deve haver nenhuma alteração nos `<Card className={\`flex gap-3 p-3 relative group ...\`}>` dentro dos blocos `<Draggable>` — eles continuam sem `hoverable`/`onClick`, então não ganham motion hover (Global Constraint desta spec). Esta task só mexeu na seção de integração, no topo/rodapé da tela.

- [ ] **Step 3: Verificar visualmente**

```bash
npm run dev
```
Aba "Cardápio", confirmar que "Integração com o NTB Estoque" virou acordeão fechado por padrão, e que arrastar produtos/categorias pra reordenar continua funcionando normalmente (sem nenhum "pulo" ou conflito visual).

- [ ] **Step 4: Typecheck + build + commit**

```bash
npx tsc --noEmit && npm run build
git add components/modules/StoreModule.tsx
git commit -m "feat(lojista): Integração com o NTB Estoque em acordeão no Cardápio"
```

**Screenshot pro usuário:** aba Cardápio com o acordeão de integração fechado.

---

### Task 5: Mesas — entrada/saída de card com spring

**Files:**
- Modify: `components/modules/StoreModule.tsx`

**Interfaces:**
- Consumes: `SPRING_TAP` (`lib/motion.ts`, Task 1).

- [ ] **Step 1: Import de `motion`/`AnimatePresence`/`SPRING_TAP` em `StoreModule.tsx`**

Confirmar que o topo do arquivo já importa `motion`/`AnimatePresence` de `'motion/react'` (se não, adicionar `import { motion, AnimatePresence } from 'motion/react';`) e adicionar:
```tsx
import { SPRING_TAP } from '@/lib/motion';
```

- [ ] **Step 2: Grid de mesas ganha `AnimatePresence` + `layout`**

> **Correção pós-review (2026-08-16):** a versão original deste step só
> adicionava `hoverable` ao `Card` e envolvia o `.map` em
> `AnimatePresence`, sem nenhum `initial`/`animate`/`exit` no elemento —
> `AnimatePresence` sozinho não anima nada sem esses props no filho direto.
> A versão abaixo já corrige isso, envolvendo o `Card` num `motion.div`
> com spring de entrada/saída, mesmo padrão usado nas Tasks 6/7
> (Balcão/Cozinha-Bar) — consistência entre as 3 tasks de "cards com
> entrada/saída".

Dentro de `TablesView`, achar:
```tsx
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {tables.map((table, tableIdx) => {
                    const summary = getTableSummary(table.id);
                    const isBlocked = table.status === 'blocked';
                    const isOccupied = table.status === 'occupied' || table.status === 'waiting_bill';
                    const isWaiterRequested = table.waiter_requested;
                    const hasOrders = summary.count > 0;

                    return (
                        <Card
                            key={table.id}
                            onClick={() => { if(!isBlocked) { setSelectedTable(table); setShowFullBill(false); setShowMenuMode(false); } }}
                            className={`u-stagger relative flex flex-col justify-between p-4 transition-all duration-300 border-2 group ${
```
Trocar a linha de abertura do grid e a chamada de `<Card` por (envolve com `AnimatePresence`, `Card` ganha `layout` — a mudança de tamanho ao colapsar/expandir cards, já existente via `areCardsCollapsed`, passa a animar suave via spring em vez de saltar; `hoverable`/`onClick` já presentes mantêm o hover novo da Task 1 ativo, é o comportamento desejado aqui):
```tsx
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <AnimatePresence>
                {tables.map((table, tableIdx) => {
                    const summary = getTableSummary(table.id);
                    const isBlocked = table.status === 'blocked';
                    const isOccupied = table.status === 'occupied' || table.status === 'waiting_bill';
                    const isWaiterRequested = table.waiter_requested;
                    const hasOrders = summary.count > 0;

                    return (
                        <Card
                            key={table.id}
                            hoverable
                            onClick={() => { if(!isBlocked) { setSelectedTable(table); setShowFullBill(false); setShowMenuMode(false); } }}
                            className={`u-stagger relative flex flex-col justify-between p-4 transition-all duration-300 border-2 group ${
```

(o `hoverable` é novo — hoje o `Card` de mesa já tinha `onClick`, então já ganharia o hover motion da Task 1 de graça; adicionar `hoverable` explicitamente só reforça a intenção, não muda comportamento.)

Achar o fechamento do `.map` (mais abaixo, onde o `Card` de mesa termina e o `.map` retorna):
```tsx
                        </Card>
                    );
                })}
            </div>
```
(esse é o padrão geral — localizar o `})}` que fecha exatamente o `.map(table => ...)` de `TablesView`, não outro `.map` do mesmo arquivo) e trocar por:
```tsx
                        </Card>
                    );
                })}
                </AnimatePresence>
            </div>
```

- [ ] **Step 3: Verificar visualmente**

```bash
npm run dev
```
Abrir Mesas, clicar em "Colapsar Cards"/"Expandir Cards" — confirmar que a mudança de altura anima suave (spring), não salta instantâneo. Abrir uma mesa e fechar a conta (ou usar duas abas pra simular mudança de estado em tempo real) — confirmar que não há nenhum erro de console relacionado a `key`/`AnimatePresence`.

- [ ] **Step 4: Typecheck + build + commit**

```bash
npx tsc --noEmit && npm run build
git add components/modules/StoreModule.tsx
git commit -m "feat(lojista): grid de Mesas com AnimatePresence e Card hoverable"
```

**Screenshot pro usuário:** grid de mesas, idealmente um GIF/vídeo curto do colapsar/expandir (se não for possível capturar vídeo, 2 prints — antes/depois do toggle).

---

### Task 6: Balcão — cards de pedido com entrada/saída animada

**Files:**
- Modify: `components/modules/StoreModule.tsx`

**Interfaces:**
- Consumes: `SPRING_TAP` (Task 1).

- [ ] **Step 1: Grid de pedidos do Balcão ganha `AnimatePresence`**

Dentro de `CounterView`, achar:
```tsx
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {orders.map(order => {
                const itemCount = order.order_items?.reduce((a,b) => a+b.quantity, 0) || 0;
                const total = order.order_items?.reduce((a,b) => a+(b.quantity * b.price_at_time), 0) || 0;
                const status = order.status;

                return (
                    <Card key={order.id} accentColor="var(--brand)" className="flex flex-col p-4 pl-5">
```
Trocar por:
```tsx
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
            {orders.map(order => {
                const itemCount = order.order_items?.reduce((a,b) => a+b.quantity, 0) || 0;
                const total = order.order_items?.reduce((a,b) => a+(b.quantity * b.price_at_time), 0) || 0;
                const status = order.status;

                return (
                    <motion.div
                        key={order.id}
                        layout
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={SPRING_TAP}
                    >
                    <Card accentColor="var(--brand)" className="flex flex-col p-4 pl-5">
```
Achar o fechamento correspondente do `Card` desse `.map` (mais abaixo):
```tsx
                    </Card>
                );
            })}
```
Trocar por:
```tsx
                    </Card>
                    </motion.div>
                );
            })}
            </AnimatePresence>
```

(o `key` sai do `Card` — `Card` não tem prop `key` de qualquer forma em React, quem precisa da `key` é o `motion.div` que agora envolve; `Card` perde o `key={order.id}` que tinha antes, o `motion.div` externo assume essa responsabilidade.)

- [ ] **Step 2: Verificar visualmente**

```bash
npm run dev
```
Abrir Balcão, criar um pedido de teste (ou usar uma loja de teste com pedidos existentes), confirmar que o card aparece com um leve "pop" (fade+scale) ao surgir, e desaparece suave ao ser fechado/entregue — não só some instantâneo.

- [ ] **Step 3: Typecheck + build + commit**

```bash
npx tsc --noEmit && npm run build
git add components/modules/StoreModule.tsx
git commit -m "feat(lojista): cards de pedido do Balcão com entrada/saída animada"
```

**Screenshot pro usuário:** card de pedido do balcão em destaque.

---

### Task 7: Cozinha/Bar (KDS) — tickets com entrada/saída animada

**Files:**
- Modify: `components/modules/StoreModule.tsx`

**Interfaces:**
- Consumes: `SPRING_TAP` (Task 1).

- [ ] **Step 1: Grid de tickets do KDS ganha `AnimatePresence`**

Dentro de `KdsView`, achar:
```tsx
    <div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {orders.map(item => {
                const { client, observation } = parseItemNote(item.notes || '');
                const late = isItemLate(item);

                return (
                    <Card key={item.id} className={`${getStatusColor(item.status)} p-4 border-2 transition-all duration-300 shadow-sm hover:shadow-md ${late ? 'border-[var(--err)] ring-2 ring-[var(--err)]/30' : ''}`}>
```
Trocar por:
```tsx
    <div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence>
            {orders.map(item => {
                const { client, observation } = parseItemNote(item.notes || '');
                const late = isItemLate(item);

                return (
                    <motion.div
                        key={item.id}
                        layout
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.92 }}
                        transition={SPRING_TAP}
                    >
                    <Card className={`${getStatusColor(item.status)} p-4 border-2 transition-all duration-300 shadow-sm hover:shadow-md ${late ? 'border-[var(--err)] ring-2 ring-[var(--err)]/30' : ''}`}>
```

Achar o fechamento correspondente (mais abaixo, onde este `Card` de ticket termina e o `.map` retorna):
```tsx
                    </Card>
                );
            })}
        </div>
    </div>
  );
};
```
Trocar por:
```tsx
                    </Card>
                    </motion.div>
                );
            })}
            </AnimatePresence>
        </div>
    </div>
  );
};
```

(mesmo raciocínio do Task 6 — `key` sai do `Card`, vai pro `motion.div` externo.)

- [ ] **Step 2: Verificar visualmente — o mais importante desta rodada (tela fica ligada o dia todo)**

```bash
npm run dev
```
Abrir Cozinha (ou Bar), fazer um pedido de teste chegar (via `/c/<slug>` numa aba separada, loja de teste) — confirmar que o ticket novo entra com um leve slide-up+fade. Avançar o status até "Entregue" (ou cancelar um item) — confirmar que o ticket sai da tela com fade+shrink, não só desaparece.

- [ ] **Step 3: Typecheck + build + commit**

```bash
npx tsc --noEmit && npm run build
git add components/modules/StoreModule.tsx
git commit -m "feat(lojista): tickets de Cozinha/Bar com entrada/saída animada"
```

**Screenshot pro usuário:** tela de Cozinha ou Bar com um ticket em destaque.

---

### Task 8: Verificação final + deploy

**Files:** nenhum (só verificação e deploy).

- [ ] **Step 1: Build de produção limpo**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit && npm run build
```

- [ ] **Step 2: Walkthrough visual completo (Playwright, `npm run dev` local)**

Login universal, cobrir, numa loja de teste (Bistrô Demo ou Vieras e Vinhos):
- Mesas: colapsar/expandir cards anima suave; abrir/fechar mesa; qualquer modal (ex.: adicionar item) abre com fade+scale spring.
- Balcão: pedido novo aparece com pop, pedido fechado some suave.
- Cozinha e Bar: ticket novo entra, ticket concluído sai, ambos com spring.
- Cardápio (admin): "Integração com o NTB Estoque" abre/fecha em acordeão; drag-and-drop de categorias/produtos continua normal, sem glitch.
- Administração → Notas Fiscais: histórico primeiro, "Certificado e Configuração Fiscal" fechado por padrão, abre com bounce, salva normalmente.
- Master Admin (`/painel`): editar loja, "Certificado e Configuração Fiscal" em acordeão com badge de status visível fechado; qualquer botão do painel tem o leve "encolhida" ao clicar.
- Emular `prefers-reduced-motion: reduce` (DevTools → Rendering) e repetir os pontos acima — tudo deve praticamente não springar (Motion respeita automaticamente, sem checagem manual em nenhum ponto novo desta rodada).
- Cardápio do cliente (`/c/<slug>`): confirmar que continua idêntico ao de antes desta rodada (herdou só o novo `Button`/`Modal variant='center'` — nenhum consumidor lá usa `variant='center'` além de telas que já eram admin/lojista, então não deveria mudar nada visualmente).

- [ ] **Step 3: Deploy pro `testvendase`**

```bash
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-vendas && bash deploy.sh"
curl -s -o /dev/null -w "%{http_code}\n" "https://testvendase.norteparanegocios.com.br/loja"
```
Esperado: `200`, e o serviço `ntb-vendas` reiniciado sem erro no log do `deploy.sh`.

- [ ] **Step 4: Capturas finais pro usuário**

Mandar pelo menos 4 capturas: Mesas, Cozinha/Bar com ticket, Notas Fiscais com acordeão fechado, e o form de loja do Master Admin com o acordeão fechado.
