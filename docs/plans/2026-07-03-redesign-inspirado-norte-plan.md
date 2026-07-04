# Mega plano: redesign do ntb-vendas-next inspirado no norteparanegocios.com.br

Data: 2026-07-03
Status: em execução

## Diagnóstico (varredura)

O design system (`app/globals.css`) já compartilha a paleta do site
institucional: mesmo azul de marca `#484DB5`, mesma tinta escura `#1E1B4B`,
tokens semânticos WCAG-safe, movimento tom Linear/Stripe (`u-motion`,
`u-press`, `u-stagger`). O que falta pra parecer o site institucional:

1. **Fonte diferente.** Site usa **Atkinson Hyperlegible** (display + body);
   app usa Plus Jakarta Sans. É a mudança de maior impacto de marca e a de
   menor risco.
2. **Personalidade "nuvem/flutuante" só existe na landing.** As telas de
   login usam blur-orbs genéricos (`auth-orb`), não o motivo de nuvens +
   ícone flutuante do site. O site tem animações `rocket-float`, `bounce`,
   `grow`, `pulse`.
3. **Cardápio do cliente** (superfície de marca #1, cliente final) é
   funcional mas sem o toque de marca no header nem entrada escalonada dos
   produtos.
4. **Painel do lojista** é ferramenta de trabalho densa: polish leve só
   (stagger, micro-interações), sem "circo" que atrapalhe uso em cozinha.

Cores do site pra referência (extraídas do CSS real): azuis
`#6b71f2`/`#6366f1`/`#484db5`/`#312c85`/`#1e1b4b`, acentos `#f43f5e` (rosa),
`#22c55e` (verde), `#00d6d6` (ciano).

## Princípios (regra do redesign)

Trabalhar com a stack existente (Tailwind v4 + tokens CSS), não reescrever.
Não quebrar funcionalidade: `tsc` + `build` limpos e verificação visual no
navegador após cada fase. Telas de trabalho (KDS/mesas) recebem polish
discreto, não animação pesada.

## Fase A — Fundação de marca (baixo risco, impacto alto)

- **A1.** Trocar a fonte carregada em `app/layout.tsx` e o `--font-sans-src`
  em `globals.css` de Plus Jakarta Sans para **Atkinson Hyperlegible**
  (pesos 400/700, é o que o Google Fonts oferece), mantendo JetBrains Mono
  nos números. Fallback stack preservado.
- **A2.** Adicionar em `globals.css` os keyframes de personalidade do site:
  `cloud-drift` (nuvem deslizando devagar), `soft-bounce` (entrada com
  leve quique), `grow-in` (escala 0.9→1 + fade). Reaproveitar `icon-float`
  que já existe.

## Fase B — Telas de pré-login (marketing, seguras pra encantar)

- **B1.** Criar um componente reutilizável `AuthBackdrop` (novo arquivo
  `components/AuthBackdrop.tsx`) com o motivo real do site: fundo azul
  sólido `#484DB5`, duas camadas de nuvem SVG no rodapé (reaproveitar os
  paths já extraídos em `app/page.tsx`), grão sutil. Sem parallax de mouse
  aqui (é login, não precisa), só as nuvens em `cloud-drift` lento.
- **B2.** Aplicar o `AuthBackdrop` nas 4 telas de login em `StoreModule.tsx`
  (login lojista, troca de senha, seletor de loja universal) e na de
  `AdminModule.tsx`, trocando os `auth-orb` blur genéricos. Card branco
  flutuante com `grow-in` na entrada. Manter `force-light` (regra: pré-auth
  sempre claro).
- **B3.** Aplicar o mesmo backdrop no 404 (`app/not-found.tsx` se existir,
  senão criar).

## Fase C — Cardápio do cliente (`ClientModule.tsx`)

- **C1.** Header do cardápio com faixa/gradiente azul de marca + nuvem sutil
  no rodapé da faixa (não o header inteiro, só um toque).
- **C2.** Cards de produto (`ProductCard`): entrada escalonada com `grow-in`
  por índice, hover com leve elevação (transform, GPU), cantos coerentes.
- **C3.** Tela "Pedido Finalizado" e banner "Pronto": alinhar ao espírito
  alegre do site (o widget de avaliação já foi adicionado; só refinar o
  entorno). Empty states do cardápio com um toque de marca em vez de texto
  seco.

## Fase D — Painel do lojista (polish discreto)

- **D1.** Sidebar: refinar o cabeçalho da loja, garantir estado ativo claro.
- **D2.** Cards de mesa / KDS / dashboard: entrada escalonada onde já não
  existe, micro-interação de hover consistente (`u-card`), sem animação que
  atrapalhe o uso operacional.
- **D3.** Stat cards do dashboard: `grow-in` escalonado.

## Verificação

Após cada fase: `npx tsc --noEmit` + `npm run build` limpos, e screenshot ao
vivo (Playwright headless na porta do dev) das telas afetadas, comparando
antes/depois. Commit por fase. Push ao final.
