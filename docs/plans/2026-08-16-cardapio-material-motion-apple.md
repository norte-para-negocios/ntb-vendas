# Cardápio do cliente: material de vidro + movimento "estilo Apple"

Data: 2026-08-16
Status: spec validada com o usuário (mockups + demo de mola no companion visual), aguardando revisão antes de virar plano de execução

## Diagnóstico

O cardápio do cliente (`ClientModule.tsx`) já passou por 3 rodadas nesta
sessão: (1) categorias em acordeão + cor/decoração ("carta de vinhos"), (2)
reversão de cor (dourado só em preço, azul nos CTAs), (3) primeira dose de
`motion` (spring no acordeão). O usuário validou o resultado de cor/decoração,
mas achou o *movimento* mecânico — pediu explicitamente pra parar de fazer
ajuste reativo e planejar direito, pesquisando as skills disponíveis antes de
codar.

**Pesquisa feita** (3 fontes, não é achismo):
- Skill `apple-design` (baseada em *Designing Fluid Interfaces*, WWDC 2018,
  e *Principles of Great Design*, WWDC 2026) — filosofia: motion baseado em
  spring (damping/response, não duração fixa), interruptível, 1:1 com o
  gesto, projeção de momentum, rubber-banding em limites, materiais
  translúcidos como camada funcional (nunca decorativa).
- Skill `motion-design-skill` — tabelas de timing/personalidade de marca
  (Premium: 350-600ms, sem overshoot — mas o teste real no companion validou
  um damping mais próximo do "Playful/momentum" da Apple, ver Decisão 2).
- Skill `motion` (a lib React) + suas referências `core-concepts-deep-dive.md`
  e `accessibility-guide.md` — API concreta: `drag="y"` + `dragConstraints` +
  `dragElastic` (rubber-band pronto), `onDragEnd` com `info.velocity`/`info.offset`
  pra decidir fechar-ou-voltar, `MotionConfig reducedMotion="user"` cobre
  `prefers-reduced-motion` automaticamente em qualquer componente `motion.*`
  (incluindo drag), sem precisar checar manualmente em cada lugar.

**Validado com o usuário no companion visual** (não é decisão só minha):
- Material: **vidro/translúcido** (opção B de 3 mockups lado a lado) — não
  "sutil" (A) nem "camadas pesadas" (C).
- Intensidade da mola: **bounce leve** (opção B de 3, demo interativa com
  física real via `requestAnimationFrame`) — bate com o valor real que a
  Apple documenta pra drawer/sheet (`damping ≈ 0.8`), não inventei o número.
- Bottom sheets (comanda, produto): usuário escolheu **arrastar pra fechar
  de verdade** (não só toque), sabendo que é mais esforço que a opção
  simples.

## Escopo

**Só o cardápio do cliente** (`components/modules/ClientModule.tsx`),
decisão explícita do usuário nesta sessão — painel do lojista, admin e
telas de login ficam pra sub-projetos futuros (já registrados em
`docs/plans/2026-08-16-backlog-garcom-integracao-redesign.md`, item 3).

Onde a mudança precisar tocar o componente `Modal` compartilhado
(`components/ui.tsx`, usado em admin/lojista também), é **sempre via prop
opcional nova** — quem não passar a prop continua exatamente como hoje. Não
mexer no comportamento padrão de nenhum componente compartilhado.

## Princípios (regras do redesign, não negociar sem motivo novo)

1. **Vidro/blur só em chrome fixo — nunca em conteúdo que rola.** Cabeçalho
   sticky de busca/ordenação, botão flutuante de comanda, e modais/sheets
   recebem `backdrop-filter` de verdade. A lista de produtos (rola o tempo
   todo) nunca recebe blur — é o princípio mais repetido nas 3 fontes de
   pesquisa (custo de repaint de GPU numa área que rola constante).
2. **As linhas de categoria do acordeão ganham a LINGUAGEM visual de vidro
   (superfície translúcida, borda fina clara, sem sombra pesada) mas SEM
   `backdrop-filter` de verdade** — elas fazem parte do conteúdo que rola
   (a lista inteira rola junto), então blur real ali violaria o princípio 1.
   Isso reconcilia o mockup B (aprovado) com a regra de performance: mesmo
   visual, sem o custo.
3. **Spring, não duração fixa.** Todo abrir/fechar/expandir usa
   `type: "spring"` com o damping validado (~0.82), nunca `duration`+easing
   craft-CSS. Toque em botão sempre com `whileTap`, nunca só `:active` CSS.
4. **Bottom sheets seguem o dedo 1:1**, resistem com rubber-band ao passar
   do limite, e decidem fechar-ou-voltar pela **velocidade** do gesto ao
   soltar (projeção de momentum), não só pela posição final.
5. **`prefers-reduced-motion` e `prefers-reduced-transparency` sempre
   respeitados** — motion via `MotionConfig reducedMotion="user"` (cobre
   springs e drag automaticamente); transparência via media query manual
   nova (a lib não cobre isso, só motion).

## Decisões técnicas concretas

**Material (vidro):**
- Barra de busca/ordenação (sticky) e botão flutuante "Ver Comanda":
  `background: rgba(255,255,255,0.06)` (sobre `--ink`) +
  `backdrop-filter: blur(14px) saturate(160%)` + borda
  `1px solid rgba(255,255,255,0.12)` — os valores testados no mockup B.
- Modais (ProductModal, CartModal, LoginScreen overlay, BillSplitter): scrim
  de fundo mais escuro (`rgba(10,13,19,0.82)`) + o painel do modal em si com
  o mesmo vidro acima.
- Linhas de categoria do acordeão: mesma cor/borda translúcida, **sem**
  `backdrop-filter` (ver Princípio 2).
- `prefers-reduced-transparency: reduce`: sobe a opacidade do fundo (mais
  sólido) e zera o `backdrop-filter` nesses elementos — mesmo padrão já
  documentado na skill `apple-design`.

**Movimento (spring):**
- Acordeão de categoria: já usa `motion` desde a rodada anterior — só
  recalibrar o damping pro valor validado (0.82) e manter.
- Modais (entrada/saída): `AnimatePresence` + `initial/animate/exit` com
  spring (scale+fade a partir do gatilho, não fade genérico) em vez do CSS
  atual (`animate-[fadeIn...]`/`animate-[slideUp...]`).
- Botões de ação dentro do cardápio (CTA "Adicionar", "Confirmar Pedido",
  "Abrir Mesa", chips de categoria): `whileTap` com spring — hoje só o "+"
  de adicionar rápido tem isso.

**Bottom sheets com arrastar (CartModal, ProductModal em mobile,
BillSplitter):**
- `drag="y"`, `dragConstraints={{ top: 0 }}` (não deixa arrastar pra cima
  do repouso — não tem nada acima), `dragElastic={{ top: 0.05, bottom: 0.5
  }}` (quase rígido subindo, elástico descendo).
- `onDragEnd`: se `info.velocity.y` passar um limiar (flick rápido pra
  baixo) OU `info.offset.y` passar uma fração da altura da folha mesmo sem
  flick, fecha (`onClose()`); senão, spring de volta pro `y: 0`.
- `MotionConfig reducedMotion="user"` envolvendo o cardápio inteiro cobre
  esse gesto automaticamente quando o usuário tem "reduzir movimento"
  ligado no aparelho — vira fechar/abrir instantâneo, sem gesto de
  arrastar.

## O que fica de fora desta rodada (registrado, não esquecido)

- Qualquer coisa fora de `ClientModule.tsx` (painel do lojista, admin,
  login) — sub-projeto futuro.
- Mudar o componente `Modal` compartilhado por padrão pra todo o app — só
  prop opcional nova.
- `layoutId`/shared-element transition entre o card do produto na lista e o
  modal aberto (a lib suporta, é um "uau" real, mas é escopo novo não
  pedido — anotar como ideia pra próxima rodada se fizer sentido).

## Próximo passo

Spec pronta pra virar plano de execução (fases/tarefas concretas por
arquivo). Só falta a revisão do usuário neste documento antes de eu montar
o plano linha a linha.
