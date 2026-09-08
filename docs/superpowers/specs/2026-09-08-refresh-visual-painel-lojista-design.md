# Refresh visual do painel do lojista — design

## Contexto e objetivo

Pedido do dono (2026-09-08), depois de testar o app desktop de ponta a
ponta: o painel logado do lojista (`StoreModule.tsx`) tem identidade
visual genérica de "SaaS admin" — contrasta com o cuidado visual já
existente em `/acesso` (fundo azul de marca, nuvens, gradiente) e no
cardápio do cliente (`ClientModule.tsx`, identidade "carta de vinhos").
Objetivo: fechar essa lacuna com mudanças aditivas, sem tocar em lógica
de negócio, banco de dados ou fluxo — puramente visual, reaproveitando
dado e estado que já existem.

**Fora de escopo, explícito:** qualquer mudança de estrutura de
navegação, novo dado no banco, nova RPC, ou redesenho do cardápio do
cliente/tela de login (essas já têm identidade própria e não fazem
parte deste pacote).

## Escopo (aprovado pelo usuário)

1. Identidade visual no header/sidebar do painel logado.
2. Cards de dados: sparkline no faturamento + cor por tempo de ocupação
   nas mesas.
3. KDS: pulso visual no item atrasado.
4. Estados vazios com texto/ícone variado por contexto.

## 1. Identidade visual (header/sidebar)

**Onde:** `StoreLayout` (componente de shell do painel logado em
`StoreModule.tsx` — cabeçalho + sidebar compartilhados por todas as
abas).

- Uma faixa de 4px no topo do header, cor `--brand` (mesmo azul
  `#484DB5` usado em `AuthBackdrop`/`/acesso`), sempre visível
  independente da aba ativa — puro CSS, `border-top` ou `::before`.
- Item ativo da sidebar ganha uma barra vertical de 3px na borda
  esquerda (`border-left: 3px solid var(--brand)`), além do
  destaque de fundo que já existe hoje (`bg-[var(--surface)]` na aba
  ativa) — as duas pistas visuais reforçam, não substituem uma à outra.
- Sem mudança de estrutura HTML além de uma classe condicional na aba
  ativa (o código já sabe qual aba está ativa, é a mesma condição que já
  decide o `bg-[var(--surface)]`).

## 2. Cards de dados

### 2a. Sparkline nos cards de faturamento

**Onde:** `StoreDashboardView.tsx`, os 3 cards "Hoje" / "Esta Semana" /
"Este Mês" dentro de "Faturamento Bruto".

- Fonte de dado: `fetchSalesHistory` já é chamado para popular o resto
  do dashboard — a agregação por dia dos últimos 7 dias é um `reduce`
  novo em cima do MESMO array já buscado, não uma query nova.
- Renderização: um `<svg>` inline simples (polyline conectando os 7
  pontos, sem eixo/grid/tooltip — decorativo, não substitui o gráfico
  "Por Período" mais detalhado que já existe mais abaixo na tela), cor
  `--brand` com opacidade baixa, posicionado atrás/abaixo do número via
  `position: absolute` no card (que já é `position: relative`).
- Se houver menos de 2 dias de dado (loja nova), a sparkline não
  renderiza (linha de 1 ponto não comunica nada) — o card volta ao
  visual de hoje, sem espaço vazio reservado.

### 2b. Cor por tempo de ocupação nos cards de mesa

**Onde:** `TablesView`, o card de cada mesa (`MESA {number}`).

- Reaproveita o MESMO cálculo de tempo de ocupação que já alimenta o
  texto "Xmin" exibido no card hoje (não é um dado novo).
- Limiares reaproveitados do "Modo Rush" já existente no código (mesmos
  cortes de tempo já usados pra decidir o que conta como "rush") —
  aplicados como 3 variantes de cor de borda/fundo do card:
  `--ok` (dentro do normal) → `--warn` (atenção) → `--err` (crítico).
  Sem novo limiar inventado; é o mesmo dado, exibido em mais um lugar.
- Só se aplica a mesas `occupied`/`waiting_bill` — mesa `available` ou
  `blocked` mantém o visual neutro de hoje.

## 3. KDS — pulso visual de atraso

**Onde:** `KdsView`, o card de item que já passou do tempo de preparo.

- Reaproveita a MESMA condição booleana que já dispara o som de atraso
  hoje (comparação contra `prep_time_minutes`) — zero lógica nova, só
  uma classe CSS condicional a mais no card (`animate-pulse-border` ou
  equivalente, `@keyframes` novo em `globals.css`: opacidade da borda
  oscilando suavemente, sem mover/redimensionar o card — nada que atrapalhe
  clicar nos botões de status).
- Pulso para assim que o item avança de status (mesma transição que já
  limpa/troca o card hoje).

## 4. Estados vazios variados

**Onde:** os 4 estados vazios que hoje reusam o mesmo ícone de check +
texto genérico: Balcão ("Tudo tranquilo no balcão!"), KDS Cozinha/Bar
("Tudo tranquilo na cozinha/bar!"), Recebíveis ("Nenhum recebível
pendente"), Mesas (se aplicável).

- Cada um ganha um ícone `lucide-react` temático (ex.: `UtensilsCrossed`
  pra cozinha, `Wallet`/`CheckCircle` pra recebíveis já ocupado hoje —
  variar pelo menos cor/ícone por contexto) e a frase já existente
  mantida (não é pedido de copywriting novo, só parar de repetir o
  MESMO ícone check em 4 lugares diferentes).
- Puramente visual — sem novo componente reutilizável forçado; cada
  view já renderiza seu próprio estado vazio inline, só troca o ícone/
  cor usada.

## Testes

Sem suíte automatizada neste projeto (padrão já documentado). Verificação
por task, ao vivo, na ZZ Laboratorio — screenshot antes/depois de cada
frente antes de considerar concluída.

## Fora de escopo (registrado, não esquecido)

- Modo claro (`.light`) — todos os exemplos acima assumem o tema escuro
  já visto em produção; se o modo claro estiver em uso, os tokens
  semânticos (`--brand`, `--ok`, `--warn`, `--err`) já se adaptam
  sozinhos (são os mesmos usados em todo o resto do app), então não
  deveria exigir trabalho extra, mas não foi verificado neste spec.
- Ilustrações customizadas desenhadas à mão — usamos ícones já
  disponíveis na lib (`lucide-react`), não SVGs de marca sob encomenda.
