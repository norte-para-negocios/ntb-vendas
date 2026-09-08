# Refresh Visual do Painel Lojista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar identidade visual de marca ao painel logado do lojista (hoje "SaaS admin" genérico), reforçando visualmente urgência/estado onde já existe dado — sem tocar em lógica de negócio, banco de dados ou fluxo.

**Architecture:** 4 mudanças aditivas e independentes em `components/modules/StoreModule.tsx` / `StoreDashboardView.tsx` / `app/globals.css` — cada uma reaproveita dado/estado que já existe no componente, sem query nova, sem RPC nova, sem migration.

**Tech Stack:** React/TSX + Tailwind v4 (tokens semânticos já existentes: `--brand`, `--ok`, `--warn`, `--err`), CSS puro pra keyframes novos.

**Spec:** `docs/superpowers/specs/2026-09-08-refresh-visual-painel-lojista-design.md`

## Global Constraints

- Nenhuma migration, RPC ou coluna nova — todo dado usado já é buscado/calculado hoje.
- Sem suíte de testes automatizada neste projeto — verificação é sempre manual (`npx tsc --noEmit`, `npm run build`, e conferência visual ao vivo na loja "ZZ Laboratorio (NAO E CLIENTE)" com screenshot antes/depois).
- Tokens de cor sempre via `var(--brand)`/`var(--ok)`/`var(--warn)`/`var(--err)` — nunca hex literal novo.
- Nenhuma mudança de estrutura de navegação, contrato de dado, ou comportamento de clique/permissão.

---

## Task 1: Identidade visual — faixa de marca no header + indicador na sidebar

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`StoreLayout`, linhas ~577 e ~703)

**Interfaces:**
- Consumes: `currentTab`, `visibleTabs` (já existem em `StoreLayout`, nenhuma mudança de assinatura).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Faixa de marca no header desktop**

Em `StoreLayout`, o `<header>` dentro de `<main>` (por volta da linha 703):

```tsx
<header className="relative mb-6 hidden md:flex justify-between items-center before:content-[''] before:absolute before:-top-4 before:md:-top-6 before:left-0 before:right-0 before:h-1 before:bg-[var(--brand)] before:rounded-full">
```

(troca só a className do `<header>` — adiciona `relative` + o pseudo-elemento `before:` posicionado pra encostar na borda superior da área de conteúdo, sem alterar o conteúdo interno do header nem o espaçamento existente abaixo dele.)

- [ ] **Step 2: Barra de aba ativa na sidebar desktop**

No `<nav>` da sidebar desktop (por volta da linha 596-602), o botão de cada aba:

```tsx
<button
  key={item.id}
  onClick={() => onTabChange(item.id)}
  className={`flex items-center w-full px-3 py-2.5 rounded-[var(--r-md)] text-[13px] font-medium u-motion group relative
    ${currentTab === item.id ? 'bg-white/12 text-white border-l-[3px] border-l-[var(--brand)] pl-[9px]' : 'text-white/45 hover:bg-white/8 hover:text-white/75'}
    ${isCollapsed ? 'justify-center' : 'gap-3'}
  `}
  title={isCollapsed ? item.label : ''}
>
```

(a única mudança é acrescentar `border-l-[3px] border-l-[var(--brand)] pl-[9px]` no ramo `currentTab === item.id` do ternário — `pl-[9px]` compensa a borda nova de 3px pra o conteúdo não deslocar 3px pra direita em relação ao estado inativo, que tem `px-3` = 12px de padding esquerdo; 12px - 3px = 9px.)

- [ ] **Step 3: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Verificação visual ao vivo**

Rodar `npm run dev`, logar na ZZ Laboratorio, confirmar visualmente: faixa azul fina no topo da área de conteúdo (visível em qualquer aba), e a aba ativa da sidebar com uma barra azul de 3px na borda esquerda além do destaque de fundo já existente. Tirar screenshot antes/depois.

- [ ] **Step 5: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat: identidade de marca no header/sidebar do painel lojista

Faixa azul (var(--brand)) no topo da área de conteúdo + barra lateral
na aba ativa da sidebar — reduz a distância visual entre o painel
logado e a identidade já usada em /acesso e no cardápio do cliente.
Puramente CSS, nenhuma mudança de estrutura/comportamento."
```

---

## Task 2: Sparkline nos cards de faturamento (Dashboard)

**Files:**
- Modify: `components/modules/StoreDashboardView.tsx`

**Interfaces:**
- Consumes: `sales: Order[]` (prop já existente do componente), `getOrderDisplayTotal` (já importado de `@/lib/calc`), `subDays`/`isSameDay` (já importados de `date-fns`).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Calcular a série dos últimos 7 dias**

Logo depois da declaração de `dailyStats`/`weeklyStats`/`monthlyStats` (por volta da linha 158), adicionar:

```tsx
// Task 2 (refresh visual, 2026-09-08): série diária pros últimos 7 dias,
// só pra desenhar a sparkline decorativa nos 3 cards de topo — mesma
// fonte de dado (`sales`) já carregada, nenhuma busca nova. Um dia sem
// venda vira 0 (não é omitido), senão a linha da sparkline distorceria
// a posição dos outros pontos.
const last7DaysTotals = useMemo(() => {
    const days: number[] = [];
    for (let i = 6; i >= 0; i--) {
        const day = subDays(now, i);
        const dayTotal = sales
            .filter(s => isSameDay(new Date(s.created_at), day))
            .reduce((sum, o) => sum + getOrderDisplayTotal(o), 0);
        days.push(dayTotal);
    }
    return days;
}, [sales, now]);

// Sparkline só faz sentido com pelo menos 2 dias com venda de verdade —
// com 0 ou 1, uma "linha" não comunica tendência nenhuma.
const hasEnoughDataForSparkline = last7DaysTotals.filter(v => v > 0).length >= 2;
```

- [ ] **Step 2: Componente de sparkline (SVG inline, sem dependência nova)**

Antes da declaração de `StoreDashboardView` (ou logo depois dos imports, como função auxiliar no mesmo arquivo):

```tsx
// SVG inline decorativo — não usa Recharts de propósito (Recharts já é
// usado no resto do arquivo, mas é pesado demais pra um sparkline de
// 7 pontos sem eixo/tooltip/legenda; um polyline puro é mais barato e
// mais simples de posicionar atrás do número do card).
function Sparkline({ values, color }: { values: number[]; color: string }) {
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const width = 100;
    const height = 32;
    const points = values
        .map((v, i) => {
            const x = (i / (values.length - 1)) * width;
            const y = height - ((v - min) / range) * height;
            return `${x},${y}`;
        })
        .join(' ');
    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="absolute bottom-0 right-0 w-24 h-8 opacity-20 pointer-events-none"
        >
            <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
        </svg>
    );
}
```

- [ ] **Step 3: Renderizar a sparkline nos 3 cards de faturamento**

No `.map` dos 3 cards (por volta da linha 510-511), o `<Card>` precisa só ganhar o filho novo — resto do card inalterado:

```tsx
<Card key={label} accentColor={accent} className={`${cardCls} u-grow-in u-card pl-5`} style={{ animationDelay: `${i * 60}ms` }}>
    {label === 'Hoje' && hasEnoughDataForSparkline && (
        <Sparkline values={last7DaysTotals} color={accent} />
    )}
    <div className="flex items-center justify-between mb-2">
```

(a sparkline só aparece no card "Hoje" — os outros dois, "Esta Semana"/"Este Mês", não têm uma série diária de 7 unidades comparáveis do mesmo jeito, ver "Fora de escopo" do spec; adicionar sparkline pros outros dois exigiria decidir uma unidade de tempo diferente por card, não faz parte deste pacote.)

- [ ] **Step 4: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Verificação visual ao vivo**

Dashboard da ZZ Laboratorio (Administração → Visão Geral → Dashboard) — confirmar que o card "Hoje" mostra uma linha fina atrás do número (se houver histórico de venda em pelo menos 2 dos últimos 7 dias) e que os outros 2 cards continuam exatamente como antes. Screenshot antes/depois.

- [ ] **Step 6: Commit**

```bash
git add components/modules/StoreDashboardView.tsx
git commit -m "feat: sparkline dos últimos 7 dias no card de faturamento 'Hoje'

Mini-gráfico SVG decorativo atrás do número — mesma fonte de dado
(prop sales) já carregada pelo dashboard, sem query nova. Só aparece
com pelo menos 2 dias de venda no histórico recente."
```

---

## Task 3: Card de mesa — escalada de cor por tempo de ocupação

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`TablesView`, por volta da linha 2731-2754)

**Interfaces:**
- Consumes: `tableAlertOccupiedMin` (já existe, `store.config?.table_alert_occupied_minutes`), `minutesOccupied`/`isOccupiedTooLong`/`hasTimeAlert` (já existem no `.map` de `tables`).
- Produces: nada consumido por outra task.

**Nota de correção em relação ao spec:** o spec (seção 2b) menciona reaproveitar limiares do "Modo Rush" — na leitura do código, "Modo Rush" (`RUSH_THRESHOLD`) é sobre QUANTIDADE de mesas ocupadas simultaneamente, não sobre tempo por mesa. O mecanismo certo a reaproveitar é `tableAlertOccupiedMin`/`hasTimeAlert`, que já existe e já colore o card de âmbar quando a mesa passa do tempo configurado pela loja (linha ~2751). Esta task só ACRESCENTA um terceiro nível (vermelho) pra quando o atraso é muito mais grave que o limiar configurado — hoje só existe "normal" (azul) e "atenção" (âmbar), nunca "crítico" (vermelho).

- [ ] **Step 1: Calcular o nível crítico**

Logo depois da declaração de `hasTimeAlert` (linha ~2733):

```tsx
// Task 3 (refresh visual, 2026-09-08): terceiro nível de urgência —
// "crítico" quando o atraso é o DOBRO do limiar configurado pela loja
// (mesmo `tableAlertOccupiedMin` que já dispara o nível "atenção" em
// hasTimeAlert). Sem limiar configurado (`tableAlertOccupiedMin === 0`),
// nunca escala pra crítico — mesma regra de "recurso desligado" que
// `isOccupiedTooLong` já segue.
const isOccupiedCritical = tableAlertOccupiedMin > 0 && minutesOccupied !== null && minutesOccupied >= tableAlertOccupiedMin * 2;
```

- [ ] **Step 2: Adicionar o ramo crítico no className do Card**

No ternário de `className` do `<Card>` (linha ~2747-2754), adicionar o novo ramo ANTES de `hasTimeAlert` (mais específico primeiro, senão `hasTimeAlert` — que também é `true` quando crítico — venceria sempre):

```tsx
className={`relative flex flex-col p-3 transition-[background-color,border-color,box-shadow] duration-300 border-2 group ${
    isBlocked ? 'bg-[var(--surface-2)] border-[var(--border)] grayscale opacity-80' :
    isWaiterRequested ? 'border-[var(--err)]/50 bg-[var(--err)]/5 shadow-xl animate-pulse' :
    table.status === 'waiting_bill' ? 'bg-[var(--warn)]/5 border-[var(--warn)]/30 shadow-lg' :
    isOccupiedCritical ? 'bg-[var(--err)]/10 border-[var(--err)]/60 shadow-lg' :
    hasTimeAlert ? 'bg-[var(--warn)]/10 border-[var(--warn)]/60 shadow-lg' :
    isOccupied ? 'bg-[var(--info)]/5 border-[var(--info)]/25 shadow-lg' :
    'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--brand)]/30 hover:shadow-lg'
} ${!inJurisdiction ? 'opacity-50 pointer-events-none grayscale' : ''}`}
```

- [ ] **Step 3: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Verificação visual ao vivo**

Na ZZ Laboratorio: Administração → Configurações, confirmar/ajustar temporariamente `table_alert_occupied_minutes` pra um valor baixo (ex.: 1 minuto) só pra teste, abrir uma mesa de teste, esperar passar do dobro do limiar (ex.: 2-3 min), confirmar que o card fica vermelho em vez de âmbar. Reverter o valor de configuração ao original depois do teste. Screenshot dos 3 estados (normal/atenção/crítico) lado a lado se possível.

- [ ] **Step 5: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat: terceiro nível de urgência (crítico/vermelho) no card de mesa

Card de mesa ocupada há mais que o DOBRO do limiar configurado pela
loja (table_alert_occupied_minutes) agora fica vermelho, não só âmbar
— reaproveita o mesmo dado já usado por hasTimeAlert, sem cálculo
novo além do dobro do mesmo limiar."
```

---

## Task 4: KDS — pulso visual no item atrasado

**Files:**
- Modify: `app/globals.css` (novo `@keyframes`)
- Modify: `components/modules/StoreModule.tsx` (`KdsView`, por volta da linha 903)

**Interfaces:**
- Consumes: `late` (já existe em `KdsView`, resultado de `isItemLate(item)`).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Novo keyframe em `app/globals.css`**

Junto aos outros `@keyframes u-*` (por volta da linha 309, ao lado de `u-pulse-ring`):

```css
@keyframes u-late-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--err); }
  50% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--err) 30%, transparent); }
}
```

(anima só a opacidade do anel via `box-shadow`, nunca `transform`/tamanho — não pode interferir no clique dos botões de status dentro do card.)

- [ ] **Step 2: Aplicar a classe condicionalmente no card do KDS**

Em `KdsView`, o `<Card>` do item (linha ~903):

```tsx
<Card className={`${getStatusColor(item.status)} p-4 border-2 transition-all duration-300 shadow-sm hover:shadow-md ${late ? 'border-[var(--err)] ring-2 ring-[var(--err)]/30' : ''}`} style={late ? { animation: 'u-late-pulse 2s ease-in-out infinite' } : undefined}>
```

- [ ] **Step 3: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Verificação visual ao vivo**

Criar um pedido de teste com um produto com `prep_time_minutes` baixo (ex.: 1 min), mandar pra cozinha, esperar passar do tempo, confirmar no KDS que o card pulsa (opacidade do anel oscilando) em vez de só ficar com a borda vermelha estática. Apagar o pedido de teste depois. Screenshot/GIF se possível (é uma animação, print único não mostra o efeito).

- [ ] **Step 5: Commit**

```bash
git add app/globals.css components/modules/StoreModule.tsx
git commit -m "feat: pulso visual no item atrasado do KDS

Reforço visual pra quem trabalha com o som do alerta de atraso baixo/
desligado — a borda vermelha que já existia (estática) agora pulsa de
opacidade. Reaproveita a mesma condição 'late' que já dispara o som,
nenhuma lógica nova."
```

---

## Task 5: Estados vazios — ícone específico por contexto

**Files:**
- Modify: `components/modules/StoreModule.tsx` (2 pontos: KDS por volta da linha 994, Recebíveis por volta da linha 5224)

**Interfaces:**
- Consumes: `destination` (já existe em `KdsView`, decide 'kitchen'/'bar'), ícones `ChefHat`/`Wine`/`Wallet` (já importados no arquivo — usados hoje nos itens da sidebar em `StoreLayout`).
- Produces: nada consumido por outra task.

**Nota de correção em relação ao spec:** conferindo o código, só 2 dos estados vazios citados no spec realmente repetem o mesmo ícone (`CheckCircle`) hoje — KDS (Cozinha e Bar, que já compartilham o MESMO componente `KdsView` parametrizado por `destination`) e "Recebíveis" (Caixa). O estado vazio do Balcão já usa um ícone próprio (`Coffee`), não precisa de mudança.

- [ ] **Step 1: Ícone por destino no estado vazio do KDS**

`KdsView`, no bloco de `orders.length === 0` (linha ~992-998):

```tsx
{orders.length === 0 && (
    <div className="col-span-full flex flex-col items-center justify-center py-32 text-[var(--text-muted)] bg-[var(--surface)] rounded-[var(--r-lg)] border-2 border-dashed border-[var(--border)]">
        {destination === 'kitchen'
            ? <ChefHat className="mb-4 h-20 w-20 opacity-20" />
            : <Wine className="mb-4 h-20 w-20 opacity-20" />}
        <p className="text-xl font-medium">{destination === 'kitchen' ? 'Tudo tranquilo na cozinha!' : 'Tudo tranquilo no bar!'}</p>
        <p className="text-sm">Aguardando novos pedidos...</p>
    </div>
)}
```

(troca só o ícone `CheckCircle` — condicionado por `destination`, mesma variável que já decide o texto logo abaixo — mantém o texto e o resto da estrutura idênticos.)

- [ ] **Step 2: Ícone de carteira no estado vazio de Recebíveis**

Bloco de `queueItems.length === 0` (linha ~5222-5227):

```tsx
{queueItems.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)] bg-[var(--surface)] rounded-[var(--r-lg)] border-2 border-dashed border-[var(--border)]">
        <Wallet className="mb-3 h-14 w-14 opacity-20" />
        <p className="text-base font-medium">Nenhum recebível pendente</p>
        <p className="text-xs">Mesas que pedirem a conta e vendas de balcão aparecem aqui.</p>
    </div>
) : (
```

(troca `CheckCircle` por `Wallet` — mesmo ícone já usado na aba "Caixa" da sidebar, reforça a associação visual "isso é sobre dinheiro/recebimento".)

- [ ] **Step 3: Verificar que compila**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Verificação visual ao vivo**

Confirmar visualmente: KDS Cozinha vazio mostra ícone de chapéu de chef, KDS Bar vazio mostra ícone de taça, Recebíveis vazio (Caixa) mostra ícone de carteira. Screenshot dos 3.

- [ ] **Step 5: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat: ícone específico por contexto nos estados vazios (KDS, Recebíveis)

KDS Cozinha/Bar e Recebíveis paravam de repetir o mesmo ícone de check
genérico — cada um ganha um ícone temático (ChefHat/Wine/Wallet, já
importados no arquivo). Balcão já tinha ícone próprio, não mudou."
```
