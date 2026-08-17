# Lojista + Admin: material de vidro + motion Apple — Design Spec

**Pedido do usuário (2026-08-16):** estender pro resto do `ntb-vendas` (painel
do lojista `StoreModule.tsx` e Master Admin `AdminModule.tsx`) o mesmo
tratamento visual "Apple liquid glass" que o cardápio do cliente
(`ClientModule.tsx`) já ganhou numa rodada anterior — mais interativo, mais
animações, bonito. Pedido explícito de plano completo + execução, sem
pausa por fase ("quero plano para tudo mesmo... pode montar plano e já
executar").

## O que já existe (não reinventar)

A spec/plano anterior (`docs/plans/2026-08-16-cardapio-material-motion-apple.md`
+ `docs/superpowers/plans/2026-08-16-cardapio-material-motion-apple.md`)
validou com o usuário, num companion visual interativo, um sistema de
movimento completo — só pro cardápio do cliente. Esta spec **reaproveita
esse sistema tal como validado**, só promovendo o que hoje é local a
`ClientModule.tsx` pra um lugar compartilhado, e aplica o mesmo vocabulário
nas telas que ficaram de fora de propósito naquela rodada.

- `SPRING_TAP = { type: 'spring', bounce: 0, duration: 0.15 }` — feedback de
  toque, sem bounce.
- `SPRING_SHEET = { type: 'spring', bounce: 0.18, duration: 0.4 }` — abrir/
  fechar/arrastar de folha, acordeão, chevron.
- `.u-glass` (CSS) — vidro só em chrome FIXO (sticky/fixed/modal), nunca em
  conteúdo que rola (custo de repaint de GPU) — Princípio 1 da spec
  original, continua valendo aqui.
- Linhas que rolam (tabela, lista) ganham a "cara" de vidro só por
  cor/borda translúcida, **sem** `backdrop-filter` — Princípio 2.
- `Modal` (`components/ui.tsx`) já tem `variant?: 'center' | 'sheet'`.
- `BottomSheet` (hoje só em `ClientModule.tsx`) — scrim + folha que arrasta
  1:1 com o dedo, rubber-band, decide fechar pela velocidade do gesto.
- `MotionConfig reducedMotion="user"` já envolve o cardápio inteiro —
  cobre `prefers-reduced-motion` automaticamente em todo `motion.*`.

O lojista/admin hoje usa só CSS: `u-motion` (transition CSS genérica),
`u-press`/`u-press-sm` (`:active { transform: scale() }`, sem física real),
`u-stagger` (`animation-delay` via `--stagger` custom property, ver
`components/Skeleton.tsx`). Isso não muda de família — continua CSS puro
onde CSS já resolve bem (ex.: stagger de skeleton de loading) — só ganha
spring de verdade nos pontos de interação direta (tap, hover, expandir/
recolher, entrar/sair de tela).

## Decisão: `Button`/`Card`/`Modal` viram spring globalmente

A spec anterior deixou `Modal` variant `'center'` (o default, usado por
TODO consumidor do lojista/admin) intocado de propósito — não fazia parte
do escopo daquela rodada, e não podia mudar o visual de quem não pediu.
Agora o pedido é justamente esse resto. Decisão: em vez de embrulhar cada
botão individualmente com `motion.div` (padrão usado pontualmente na Task 6
do cardápio), o componente `Button` compartilhado em `ui.tsx` vira
`motion.button` de verdade — `whileTap={{scale:0.97}}`,
`whileHover={{scale:1.015}}` (só quando não populado por `disabled`),
`transition={SPRING_TAP}`. Um ponto de mudança só, todo o app (cardápio
incluído) ganha o upgrade de graça, sem duplicar wrapper em cada call site.
Mesmo raciocínio pro `variant='center'` do `Modal`: sai o
`animate-[fadeIn_0.2s_ease-out]`/`animate-[slideUp_...]` (CSS fixo), entra
`motion.div` com `initial={{opacity:0, scale:0.96}}`/`animate={{opacity:1,
scale:1}}`/`transition={SPRING_SHEET}` — visualmente muito parecido
(ainda centralizado, ainda some com fade), só passa a usar física de mola
de verdade em vez de duração fixa. `Card` (quando `hoverable`/`onClick`)
ganha `whileHover={{y:-2, boxShadow:...}}`/`transition={SPRING_TAP}`.

Isso é uma mudança de comportamento GLOBAL nesses 3 componentes (contraria
a constraint da spec anterior, que era específica daquela rodada). É
proporcional ao pedido atual — "o resto todo" é exatamente esse universo de
consumidores.

## Novo primitivo: `Collapsible` (`components/ui.tsx`)

Acordeão reutilizável — generaliza o padrão já construído (e validado) na
lista de categorias do cardápio (chevron + height-animate com
`SPRING_SHEET`), pra qualquer seção do lojista/admin que hoje é sempre
visível e devia ficar recolhida por padrão.

```tsx
function Collapsible({ title, defaultOpen = false, badge, children }: {
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <motion.button
        onClick={() => setOpen(o => !o)}
        whileTap={{ scale: 0.99 }}
        transition={SPRING_TAP}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 font-bold text-[var(--text)]">{title}{badge}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING_SHEET}>
          <ChevronDown size={18} className="text-[var(--text-muted)]" />
        </motion.span>
      </motion.button>
      <motion.div
        animate={{ height: open ? 'auto' : 0 }}
        transition={SPRING_SHEET}
        className="overflow-hidden"
      >
        <div className="px-5 pb-5 border-t border-[var(--border)] pt-4">{children}</div>
      </motion.div>
    </div>
  );
}
```

Primeiro consumidor: a seção "Certificado e Configuração Fiscal" (hoje
sempre aberta, ~220 linhas, empurra o histórico de notas pra baixo) — vira
`<Collapsible title="Certificado e Configuração Fiscal" defaultOpen={false}>`,
e `FiscalNotasView` (histórico) passa a renderizar ANTES dela, não depois.
Mesmo padrão se repete em `AdminModule.tsx`, que tem a mesma seção
duplicada (Master Admin editando fiscal de uma loja).

## Onde aplicar o vocabulário (telas do lojista/admin)

Cada uma vira uma task no plano de implementação. Todas herdam de graça o
upgrade de `Button`/`Card`/`Modal` (foundation) — o trabalho por tela é
sobre o que ainda falta: entrada/saída de listas com `AnimatePresence`,
hover de card, o `Collapsible` onde fizer sentido.

1. **Fundação** (`ui.tsx` + novo `lib/motion.ts`): promover
   `SPRING_TAP`/`SPRING_SHEET` de `ClientModule.tsx` pro módulo
   compartilhado; `Button`/`Card`/`Modal` ganham spring; `Collapsible` novo.
2. **Notas Fiscais** (`StoreModule.tsx` → `StoreAdminView`, aba
   "Administração"/"Notas Fiscais"): `Collapsible` na seção de
   certificado/config; histórico primeiro; linhas da tabela entram com
   `AnimatePresence`+stagger ao trocar filtro (hoje troca instantânea).
3. **Cardápio-admin** (`MenuManagementView`): cards de produto/categoria
   ganham hover-lift (`Card` já cobre isso na fundação); modal "Agrupar
   variações" e "Novo Produto" já ganham o spring do `Modal` de graça;
   avaliar `AnimatePresence` na troca de categoria selecionada.
4. **Mesas** (`TablesView`): grid de mesas — mudança de estado (livre →
   ocupada → conta pedida) ganha uma transição de cor/escala em vez de
   `transition-all duration-300` CSS fixo; tap nas mesas usa `SPRING_TAP`.
5. **Balcão** (`CounterView`): cards de pedido — mesmo tratamento de
   entrada/saída via `AnimatePresence` (pedido novo aparece, pedido
   fechado some) em vez de re-render instantâneo.
6. **Cozinha/Bar** (`KdsView`, compartilhada pelas duas abas): tickets em
   tempo real — maior ganho de UX do pacote inteiro (tela fica ligada o
   dia todo na cozinha). Ticket novo entra com spring, ticket concluído sai
   com `AnimatePresence`, mudança de status anima cor/borda.
7. **Admin geral** (`AdminModule.tsx`): lista de lojas, criação de loja,
   dashboards — mesmo `Collapsible` na seção fiscal duplicada; cards/linhas
   ganham hover; modais herdam o spring da fundação.
8. **Verificação final + deploy**: `tsc`/`build` limpos, walkthrough
   Playwright em loja de teste (nunca loja real), 2+ capturas por área
   pro usuário, deploy pro `testvendase`, smoke test do cardápio do cliente
   pra confirmar que nada regrediu (herdou o mesmo `Button`/`Modal`).

## Fora de escopo (explícito)

- Drag-to-dismiss (`BottomSheet` arrastável) fica só no cardápio — telas de
  admin/lojista são majoritariamente desktop, `Modal variant='sheet'` não
  faz sentido lá (foi pensado pra mobile). Se algum modal específico do
  lojista for usado predominantemente no celular (nenhum identificado até
  agora), reavaliar caso a caso, não por padrão.
- Nenhuma mudança de dado/backend — 100% cliente, mesmo princípio da spec
  anterior.
- Login/PIN do garçom, redesign de paleta de cores — fora desta spec (ver
  `project_ntb_vendas_backlog_2026_08_16` na memória, backlog separado).

## Global Constraints pro plano de implementação

- Todo spring novo usa `SPRING_TAP`/`SPRING_SHEET` (do novo módulo
  compartilhado) — nunca `duration` com easing CSS nem stiffness/damping
  ad-hoc.
- Vidro (`backdrop-filter`) só em chrome fixo/sticky/modal — nunca em
  conteúdo que rola (Princípio 1, herdado).
- Depois de cada task: `npx tsc --noEmit` e `npm run build` limpos antes de
  commitar.
- Testar sempre em loja de teste (ex.: Bistrô Demo/Vieras e Vinhos) no
  `testvendase` — nunca loja real de cliente.
- Screenshot pro usuário ao fim de cada task visível (padrão já
  estabelecido na sessão).
