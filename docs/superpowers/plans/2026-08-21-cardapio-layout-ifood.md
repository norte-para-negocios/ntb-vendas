# Cardápio: layout iFood — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever a apresentação do cardápio do cliente (`/c/[slug]`, `components/modules/ClientModule.tsx`) para a estrutura visual do app do iFood — hero da loja com capa e logo, tabs de categoria horizontais fixas com scroll-spy, seções empilhadas, linha de produto com miniatura à direita, e página de produto com barra de ação fixa.

**Architecture:** Todo o trabalho é de apresentação dentro de `ClientModule.tsx` + 1 componente novo compartilhado (`ProductThumb`) + 1 coluna nova em `stores` (imagem de capa) com sua UI de upload nos dois painéis. Nenhuma mudança em pedido, preço, carrinho, RPC de criação de pedido ou fluxo fiscal — o que muda é como o cardápio se parece, não como ele funciona.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4 (tokens via CSS custom properties em `app/globals.css`), `motion` v13 (`motion/react`), Supabase Postgres, Cloudinary (upload de imagem, já usado para logo).

**Spec:** Não existe documento de design separado. As fontes de verdade são: (a) 7 capturas de tela do app do iFood (página da loja Patroni) enviadas pelo usuário em 2026-08-21, descritas em detalhe na seção "Referência visual" abaixo; (b) a reunião de 2026-08-19, onde o layout do iFood foi escolhido explicitamente ("vamos tentar fazer esse cardápio parecido com praticamente uma cópia do iFood... porque todo mundo conhece o iFood, todo mundo sabe usar") junto com o pedido de imagem de fundo e logo editáveis pelo lojista.

---

## Referência visual (descrição das capturas do iFood — a "spec" desta reescrita)

Quem for implementar não tem as imagens. Esta seção é a descrição normativa delas.

**1. Topo da loja (hero):** foto do estabelecimento sangrando de borda a borda (~200px de altura), escurecida. Sobre ela, no topo: botão voltar circular à esquerda, coração e busca à direita, todos em pílulas translúcidas. Logo circular da marca (~64px, borda branca) centralizado, atravessando a borda inferior do hero. Logo abaixo, um cartão branco de cantos arredondados que sobe por cima da foto: nome da loja em ~20px semibold com um chevron `›` à direita; linha de metadados em cinza ~13px; régua fina; linha de avaliação (estrela + nota + "(85 avaliações)") com chevron. Abaixo do cartão, uma barra preta de canto a canto com texto branco centralizado ("Loja fechada • Abre amanhã às 15:00"). Abaixo dela, uma fileira horizontal de 3 cartões de cupom.

**2. Destaques:** título "Destaques" em ~19px bold. Fileira horizontal rolável de cartões (~165px de largura): foto quadrada com cantos arredondados no topo; abaixo, preço atual em roxo/magenta bold com ícone de diamante, preço cheio riscado em cinza ao lado, e um selo arredondado de desconto ("-60%") em roxo sólido com texto branco; abaixo, nome do produto em 2 linhas com reticências.

**3. Seções de categoria:** título da seção em ~19px bold, régua fina abaixo. Cada produto é uma linha: coluna de texto à esquerda (nome ~15px semibold; descrição ~13px cinza cortada em 2 linhas; linha de preço igual à dos destaques — atual em destaque, riscado, selo de desconto; e um rótulo pequeno em roxo tipo "Exclusivo Clube") e uma **foto quadrada arredondada à direita** (~88px). Régua fina separando as linhas.

**4. Barra fixa no scroll:** ao rolar, o topo vira uma barra fixa: seta voltar + campo de busca arredondado cinza ("Buscar em <loja>"). Abaixo dela, uma segunda linha fixa: ícone de menu (hambúrguer) à esquerda e **tabs de categoria horizontais roláveis**, com a categoria atual em preto bold e sublinhado, as vizinhas em cinza. As tabs acompanham a rolagem da lista (scroll-spy).

**5-7. Página do produto:** foto do prato sangrando no topo; sobre ela, botão voltar circular e uma pílula branca com logo + nome da loja + status. Abaixo, bloco branco: nome do prato ~22px bold, descrição em cinza, "Serve até 1 pessoa", selo colorido, e a linha de preço. Depois, os grupos de opção: cada um abre com uma **faixa cinza clara** contendo o título em bold ("Complemente seu pedido!") e a regra abaixo em cinza menor ("Escolha até 3 opções") — com um selo preto "OBRIGATÓRIO" à direita quando for o caso. Cada opção é uma linha: nome + preço ("+ R$ 5,90") à esquerda, miniatura à direita, e à direita de tudo um **`+` vermelho** (grupos de múltipla escolha) ou um **círculo de rádio** (escolha única). Ao final, campo "Alguma observação?" com contador "0/140" e placeholder de exemplo, e um link "Denunciar item". **Barra fixa no rodapé** em todas as telas do produto: seletor de quantidade `− 1 +` à esquerda e botão largo "Adicionar" com o preço à direita.

---

## Global Constraints

- **Nenhum produto tem foto.** Medido em 2026-08-21 no Postgres de produção: 1109 produtos nas 7 lojas, `count(image_url) = 0` em todas. O layout do iFood é carregado por foto — portanto **todo slot de imagem deste plano precisa de um fallback desenhado de propósito**, nunca um quadrado cinza vazio nem um ícone genérico de "imagem quebrada". O fallback é o `ProductThumb` da Task 1 e é obrigatório em todos os pontos (linha de produto, destaque, opção, hero do produto, carrinho). Quando fotos reais entrarem, elas substituem o fallback sem nenhuma outra mudança.
- **Isto é cardápio de salão, não delivery.** Os elementos das capturas que só existem no contexto de entrega — "Entrega rastreável", distância em km, pedido mínimo, cupons, "Loja fechada • Abre às 15:00" — **não devem ser reproduzidos com dado inventado nem com placeholder**. Onde a captura mostra um desses, este plano especifica o que entra no lugar (mesa/balcão, comanda, taxa de serviço) ou manda omitir. Nunca preencher um slot desses com texto fictício.
- **Motion:** usar exclusivamente `SPRING_TAP` e `SPRING_SHEET` de `lib/motion.ts`. O cabeçalho daquele arquivo é explícito: os dois presets foram validados visualmente com o usuário e **não se cria um terceiro sem passar pelo mesmo processo**. Manter `MotionConfig reducedMotion="user"` cobrindo a página.
- **Cor:** a regra atual do arquivo (comentários nas linhas 24-31 de `ClientModule.tsx`) é "dourado = preço/valor, `--brand` = ação". As capturas usam roxo/magenta para preço e selo e vermelho para ação — essas são as cores **do iFood**, não desta marca. Portanto: o preço em destaque e o selo de desconto usam `--brand` (`#484DB5`, a cor da Norte), e a ação (`+`, CTA) também usa `--brand`. O dourado (`WINE_GOLD`) sai do cardápio nesta reescrita. **Não introduzir roxo/magenta/vermelho do iFood.**
- **Tokens:** usar as custom properties já definidas em `app/globals.css` (`--bg`, `--surface`, `--surface-2`, `--text`, `--text-muted`, `--border`, `--brand`, `--ink`, `--r-sm/md/lg`). Não introduzir hex solto novo fora do que este plano especificar explicitamente.
- **Dois bancos.** Toda migration deste plano precisa ser aplicada nos DOIS: Supabase Cloud (`giiwtnddasminjxweohr`, via `node scripts/aplicar-migration.mjs`) e o Postgres self-hosted de produção (Contabo `185.193.66.240`, container `supabase-db`, banco `ntb_vendas`, via `docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < arquivo.sql` — **`-U supabase_admin`, não `postgres`**, que não tem permissão). **Depois de qualquer DDL no self-hosted, rodar `notify pgrst, 'reload schema';`** — sem isso o PostgREST continua servindo o cache antigo e a coluna/função nova não existe para o app (aconteceu de verdade em 2026-08-21 e derrubou a criação de pedidos até o reload).
- **Não tocar em `vendas.norteparanegocios.com.br`** (domínio definitivo) — instrução permanente do usuário. O trabalho e o teste acontecem em `testvendase.norteparanegocios.com.br`.
- **Sem suíte de testes** neste repo (`package.json` só tem `dev`/`build`/`start`/`lint`). Verificação é `npm run build` + verificação visual descrita em cada task.
- **Deploy é manual** e não faz parte de nenhuma task: `git push` + `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-vendas && bash deploy.sh"`.
- Próxima migration livre: **`047_*.sql`**.
- **Não quebrar funcionalidade existente.** Continuam funcionando exatamente como hoje, sem regressão: PIN/sessão de mesa, carrinho e seu dedup por opções, envio de pedido, `OrderTracker`/`OrderStatusPill`/`OrderStatusModal`, `BillSplitter`, favoritos em `localStorage`, busca, ordenação, filtro de favoritos, disponibilidade por horário de categoria (`isCategoryAvailableNow`), "Mais vendido", "Peça também", chips de observação rápida e o modal de confirmação de balcão.

---

## Estrutura de arquivos

- **Criar** `components/ProductThumb.tsx` — componente único de miniatura/imagem de produto com o fallback tipográfico. Usado por todos os pontos que hoje fazem `product.image_url ? <Image/> : <algo>`.
- **Modificar** `components/modules/ClientModule.tsx` — as Tasks 2-6 reescrevem regiões distintas deste arquivo.
- **Modificar** `types/index.ts` — campo `cover_url` em `Store`.
- **Criar** `supabase/migrations/047_store_cover_url.sql`.
- **Modificar** `components/modules/AdminModule.tsx` e `components/modules/StoreModule.tsx` — upload da capa (Master Admin e lojista).
- **Modificar** `lib/api.ts` — `uploadStoreCover` (alias do upload genérico já existente) e inclusão de `cover_url` no update de loja.

---

### Task 1: `ProductThumb` (fallback de imagem) + campo de capa da loja

Esta task é a fundação das outras cinco: elas todas consomem `ProductThumb`, e a Task 2 consome `cover_url`.

**Files:**
- Create: `components/ProductThumb.tsx`
- Create: `supabase/migrations/047_store_cover_url.sql`
- Modify: `types/index.ts` (interface `Store`)
- Modify: `lib/api.ts` (export `uploadStoreCover`; garantir que `cover_url` é persistido no update de loja)
- Modify: `components/modules/AdminModule.tsx` (campo de capa no "Editar Loja")
- Modify: `components/modules/StoreModule.tsx` (campo de capa na área de administração do lojista)

**Interfaces:**
- Produz: `ProductThumb` — `{ src?: string | null; name: string; size: 'row' | 'featured' | 'option' | 'hero' | 'cart'; className?: string }`. Tasks 2-6 consomem só isso; nenhuma delas deve reimplementar fallback próprio.
- Produz: `Store.cover_url: string | null`.

- [ ] **Passo 1: Migration da capa**

Criar `supabase/migrations/047_store_cover_url.sql`:
```sql
-- Imagem de capa (hero) do cardapio, pedido explicito da reuniao de
-- 2026-08-19: "dentro da administracao da loja, o cara vai poder alterar
-- ali a imagem de fundo, ou o logo". `logo_url` ja existia; capa nao.
-- Mesmo padrao de `logo_url`: URL do Cloudinary, nullable, sem RLS propria
-- (stores ja e' legivel publicamente, e' o cardapio).
alter table stores add column if not exists cover_url text;
```

Aplicar nos DOIS bancos (ver Global Constraints) e, no self-hosted, rodar em seguida:
```sql
notify pgrst, 'reload schema';
```
Confirmar nos dois:
```bash
node scripts/db.mjs "select column_name from information_schema.columns where table_name='stores' and column_name='cover_url';"
```

- [ ] **Passo 2: Tipo**

Em `types/index.ts`, na interface `Store`, logo abaixo de `logo_url`, adicionar:
```ts
  cover_url: string | null;
```

- [ ] **Passo 3: `ProductThumb`**

Criar `components/ProductThumb.tsx`. O fallback é o ponto central desta task — ele precisa parecer uma decisão de design, não uma imagem faltando. Desenho: bloco de cor derivado deterministicamente do nome do produto (mesmo produto = sempre a mesma cor, sem piscar entre renders), na família de tom da marca (baixa saturação, nunca cor pura), com a inicial do produto em tipografia grande, apertada e de baixo contraste, mais um leve degradê diagonal para não ficar chapado.

```tsx
'use client';

import Image from 'next/image';
import { useMemo } from 'react';

// Fallback de imagem de produto. Existe porque HOJE nenhum dos 1109
// produtos das 7 lojas tem foto (o catalogo vem do Omie, que nao traz
// imagem) — e o layout do cardapio e' baseado em foto. Um quadrado cinza
// vazio em cada linha faria a tela parecer quebrada; este bloco e' uma
// escolha tipografica deliberada que se sustenta sozinha ate a foto real
// existir, e sai de cena sem nenhuma outra mudanca quando ela chegar.
//
// A cor vem de um hash do nome: o mesmo produto tem sempre o mesmo tom
// (nao pisca entre renders nem entre telas), produtos diferentes se
// distinguem, e a faixa de matiz e' estreita e dessaturada de proposito
// para nunca competir com o conteudo nem virar arco-iris.

const SIZES = {
  row: { box: 'w-[88px] h-[88px] rounded-[10px]', text: 'text-[30px]', px: 88 },
  featured: { box: 'w-full aspect-square rounded-[10px]', text: 'text-[44px]', px: 330 },
  option: { box: 'w-14 h-14 rounded-lg', text: 'text-[20px]', px: 56 },
  hero: { box: 'w-full h-full rounded-none', text: 'text-[72px]', px: 1200 },
  cart: { box: 'w-12 h-12 rounded-md', text: 'text-[18px]', px: 48 },
} as const;

function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function initials(name: string): string {
  const clean = name.trim().replace(/^\d+\s*/, '');
  return (clean[0] || '?').toUpperCase();
}

export function ProductThumb({
  src,
  name,
  size,
  className = '',
}: {
  src?: string | null;
  name: string;
  size: keyof typeof SIZES;
  className?: string;
}) {
  const cfg = SIZES[size];
  const hue = useMemo(() => hueFromName(name), [name]);

  if (src) {
    return (
      <div className={`${cfg.box} relative overflow-hidden flex-shrink-0 ${className}`}>
        <Image src={src} alt={name} fill sizes={`${cfg.px}px`} className="object-cover" />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`${cfg.box} relative overflow-hidden flex-shrink-0 flex items-center justify-center ${className}`}
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 24% 92%), hsl(${(hue + 28) % 360} 20% 86%))`,
      }}
    >
      <span
        className={`${cfg.text} font-bold leading-none tracking-tight select-none`}
        style={{ color: `hsl(${hue} 30% 62%)` }}
      >
        {initials(name)}
      </span>
    </div>
  );
}
```

Nota de acessibilidade: no ramo do fallback o bloco é `aria-hidden` porque a inicial não carrega informação — o nome do produto já está no texto ao lado em todos os pontos de uso. No ramo com foto real, o `alt` é o nome do produto.

- [ ] **Passo 4: Upload da capa**

Em `lib/api.ts`, ao lado de `uploadStoreLogo` (linha ~909), adicionar:
```ts
export const uploadStoreCover = async (file: File): Promise<string> => uploadToCloudinary(file);
```
Conferir a função que atualiza a loja (a mesma que já grava `logo_url`) e garantir que `cover_url` faz parte do payload — se ela usa uma lista explícita de campos, acrescentar `cover_url`; se espalha o objeto, nada a fazer.

Em `AdminModule.tsx` ("Editar Loja") e em `StoreModule.tsx` (área de administração do lojista), acrescentar um campo "Imagem de capa do cardápio" **espelhando exatamente o padrão do campo de logo já existente em cada arquivo** (mesmo componente de input, mesmo preview, mesmo tratamento de erro, mesmo estado de carregando) — trocando `uploadStoreLogo` por `uploadStoreCover` e `logo_url` por `cover_url`. Não inventar um padrão de upload novo; copiar o que já está ali ao lado.

- [ ] **Passo 5: Verificação**

1. `npm run build` limpo.
2. Confirmar a coluna nos dois bancos (comando do Passo 1).
3. Renderizar `ProductThumb` sem `src` para 4 nomes diferentes e confirmar visualmente: 4 tons distintos, todos suaves, inicial legível, nenhum parece imagem quebrada. Confirmar que o mesmo nome dá sempre a mesma cor (recarregar a página).

- [ ] **Passo 6: Commit**
```bash
git add components/ProductThumb.tsx supabase/migrations/047_store_cover_url.sql types/index.ts lib/api.ts components/modules/AdminModule.tsx components/modules/StoreModule.tsx
git commit -m "feat(cardapio): ProductThumb com fallback tipografico + capa da loja"
```

---

### Task 2: Hero da loja

Substitui o cabeçalho atual (`ClientModule.tsx` ~2416-2464), que hoje mostra só o nome da loja em texto branco sobre `--ink`.

**Files:**
- Modify: `components/modules/ClientModule.tsx` (região do `<header>`)

**Interfaces:**
- Consome: `Store.cover_url`, `Store.logo_url` (Task 1); `ProductThumb` não é usado aqui (a capa é imagem de loja, não de produto — usar `next/image` direto, com fallback próprio descrito abaixo).

- [ ] **Passo 1: Estrutura do hero**

Reescrever o `<header>` com esta hierarquia, de cima para baixo:

1. **Faixa da capa**, altura `h-[200px]`, `relative overflow-hidden`, largura total. Se `currentStore.cover_url` existir: `next/image` com `fill`, `object-cover`, `priority`, `alt=""` (decorativa — o nome da loja está em texto logo abaixo). Se não existir: preencher com um degradê em `--ink` (`linear-gradient(135deg, var(--ink), color-mix(in srgb, var(--ink) 82%, var(--brand)))`) — sem texto e sem ícone dentro. Por cima da imagem, sempre, um degradê de escurecimento para o rodapé (`linear-gradient(to bottom, rgba(0,0,0,.18), rgba(0,0,0,.55))`) para garantir contraste dos controles.
2. **Controles sobre a capa**, `absolute` no topo, respeitando `env(safe-area-inset-top)`: à direita, os controles que hoje já existem no cabeçalho (`ThemeToggle` e sair), cada um dentro de uma pílula translúcida (`bg-black/35 backdrop-blur-sm rounded-full w-9 h-9 grid place-items-center text-white`). **Não** criar botão de voltar (não há para onde voltar — o cardápio é a raiz) nem coração/busca aqui (a busca ganha lugar próprio na Task 3).
3. **Logo circular**, só se `currentStore.logo_url` existir: 64px, `rounded-full`, `ring-4 ring-[var(--surface)]`, `object-cover`, posicionado atravessando a borda inferior da capa (`absolute left-4 -bottom-8`, com o container do cartão abaixo tendo o espaçamento correspondente). Sem logo, o cartão simplesmente começa sem recuo extra.
4. **Cartão da loja**: `bg-[var(--surface)] rounded-t-2xl -mt-4 relative z-10 px-4 pt-4 pb-3` com `shadow-[var(--shadow-md)]`.
   - Nome da loja: `text-[20px] font-semibold text-[var(--text)] leading-tight`.
   - Linha de metadados, `text-[13px] text-[var(--text-muted)] mt-1`: aqui entram **fatos do salão, nunca de entrega**. Montar a partir do que já existe em estado: se em mesa, `Mesa {numero}`; se balcão, `Balcão`; e, quando `currentStore.config.charge_service_fee` for verdadeiro, `Taxa de serviço {taxa}%` (a taxa vem de `lib/calc.ts`, `SERVICE_FEE_RATE`/`service_fee_rate`, nunca reescrita inline). Separar os pedaços com ` • `. **Não** exibir distância, tempo de entrega, pedido mínimo, nem avaliação (não há dado agregado de avaliação por loja; `order_ratings` é por pedido e hoje está praticamente vazio — não inventar nota).
   - **Sem** régua + linha de avaliação, **sem** fileira de cupons: os dois blocos das capturas não têm equivalente verdadeiro aqui e ficam de fora.
5. **Barra de status da sessão**, logo abaixo do cartão, largura total, `bg-[var(--ink)] text-white text-[13px] text-center py-2`: mostrar o estado real da comanda quando houver (ex.: `Comanda aberta • {n} itens`), e não renderizar nada quando não houver sessão. Os chips de sessão que hoje vivem no cabeçalho (nome do cliente, mesa/balcão, revelar PIN) e o botão "Conta" **continuam existindo e funcionando** — realocá-los para dentro do cartão da loja (chips) e o "Conta" como botão à direita do nome da loja, sem perder nenhum comportamento atual.

- [ ] **Passo 2: Verificação**

1. `npm run build` limpo.
2. Em `npm run dev`, abrir `/c/sertao-vai-virar-mar` e confirmar: sem `cover_url` cadastrada, a faixa mostra o degradê da marca (não um buraco branco nem imagem quebrada); o nome da loja e os controles ficam legíveis; nada de "km", "entrega", "avaliação" ou cupom aparece na tela.
3. Cadastrar uma capa pelo painel (Task 1) e recarregar: a foto aparece, o escurecimento mantém os controles legíveis, o logo atravessa a borda.
4. Confirmar que abrir mesa com PIN, revelar PIN e o botão "Conta" continuam funcionando.

- [ ] **Passo 3: Commit**
```bash
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): hero da loja com capa, logo e cartao de identificacao"
```

---

### Task 3: Busca fixa + tabs de categoria com scroll-spy (substitui o acordeão)

Esta é a mudança estrutural principal. Hoje (`ClientModule.tsx` ~2587-2694) as categorias são um **acordeão vertical de abertura única, nenhuma aberta por padrão** — o cliente precisa tocar para ver qualquer produto. O alvo é o oposto: **todas as seções empilhadas e visíveis**, com tabs horizontais fixas que acompanham a rolagem.

**Files:**
- Modify: `components/modules/ClientModule.tsx` (barra de busca ~2536, bloco do acordeão ~2587-2694)

**Interfaces:**
- Consome: `visibleCategories` e `productsByCategory` (já existem, ~2287-2329) — a lógica de filtro/busca/ordenação/horário **não muda**, só a apresentação.
- Produz: nada consumido por outras tasks.

- [ ] **Passo 1: Barra fixa de busca**

Manter a busca e a ordenação que já existem, reposicionadas numa barra `sticky top-0 z-30` com fundo `bg-[var(--surface)]/95 backdrop-blur` e `border-b border-[var(--border)]`. O campo de busca ganha a forma da referência: pílula `rounded-full bg-[var(--surface-2)]`, ícone de lupa à esquerda, `placeholder="Buscar em {nome da loja}"`. Preservar o filtro de favoritos e a ordenação já existentes (podem virar um botão de ícone que abre as opções, para caber na largura).

- [ ] **Passo 2: Tabs de categoria**

Logo abaixo da busca, dentro da mesma área fixa, uma faixa horizontal rolável (`overflow-x-auto` com `scrollbar-width: none`) com uma tab por categoria de `visibleCategories`. Tab ativa: `text-[var(--text)] font-semibold` com sublinhado de 2px em `--brand`; inativa: `text-[var(--text-muted)]`. Cada tab é um `<button>` que rola até a seção correspondente (`scrollIntoView({ behavior: 'smooth', block: 'start' })`), respeitando a altura da barra fixa (usar `scroll-margin-top` na seção, não cálculo manual de offset).

- [ ] **Passo 3: Seções empilhadas + scroll-spy**

Substituir o acordeão por seções empilhadas: para cada categoria visível, um `<section>` com `id` derivado do id da categoria e `scroll-margin-top` igual à altura da área fixa, contendo o título da categoria (`text-[19px] font-bold`) e, abaixo, a lista de produtos daquela categoria (a linha nova vem da Task 4). Todos os produtos ficam visíveis sem nenhum toque.

Scroll-spy: um único `IntersectionObserver` observando as seções, com `rootMargin` que compensa a barra fixa (ex.: `-<altura da barra>px 0px -65% 0px`) — a seção que estiver cruzando a faixa superior vira a tab ativa. Ao trocar a tab ativa, rolar a faixa de tabs para trazê-la à vista (`scrollIntoView({ inline: 'center', block: 'nearest' })`). Cuidados obrigatórios: desconectar o observer no cleanup do efeito; suprimir a atualização do spy enquanto uma rolagem disparada por clique na tab estiver em curso (senão as tabs "correm" durante a animação); e não quebrar quando a busca ativa reduz o conjunto de seções.

Com busca ou filtro de favoritos ativo, esconder a faixa de tabs e mostrar só as seções que têm resultado (o comportamento de auto-expandir do acordeão deixa de existir junto com o acordeão).

- [ ] **Passo 4: Verificação**

1. `npm run build` limpo.
2. Em `/c/sertao-vai-virar-mar`: todos os produtos aparecem sem nenhum clique; rolar a página muda a tab ativa; clicar numa tab rola até a seção com o título logo abaixo da barra fixa (não escondido atrás dela); a faixa de tabs traz a ativa para a vista sozinha.
3. Digitar na busca: tabs somem, só seções com resultado aparecem; limpar a busca restaura tudo.
4. Confirmar que categoria fora do horário (`isCategoryAvailableNow`) continua não aparecendo nem na lista nem nas tabs.

- [ ] **Passo 5: Commit**
```bash
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): tabs fixas com scroll-spy e secoes empilhadas no lugar do acordeao"
```

---

### Task 4: Linha de produto no formato iFood

Reescreve `ProductCard` (`ClientModule.tsx` 811-942), hoje uma linha editorial "carta de vinhos" sem foto, com medalhão removido e dourado no preço.

**Files:**
- Modify: `components/modules/ClientModule.tsx` (`ProductCard`)

**Interfaces:**
- Consome: `ProductThumb` (Task 1), `size="row"`.

- [ ] **Passo 1: Reescrever a linha**

Layout: `flex items-start gap-3 py-4`, com régua inferior `border-b border-[var(--border)]`.

Coluna de texto (`flex-1 min-w-0`), nesta ordem:
1. Nome: `text-[15px] font-semibold text-[var(--text)] leading-snug`, no máximo 2 linhas (`line-clamp-2`).
2. Descrição: `text-[13px] text-[var(--text-muted)] mt-0.5 line-clamp-2` (hoje é 1 linha; a referência usa 2).
3. Linha de preço, `mt-1.5 flex items-center gap-2 flex-wrap`:
   - Preço efetivo: `text-[15px] font-bold text-[var(--brand)]`, com o prefixo "A partir de" (menor, peso normal, `text-[var(--text-muted)]`) quando `hasVariablePricing(product)` — comportamento já existente, preservar.
   - Se houver promoção (`hasActivePromo`): preço cheio riscado, `text-[13px] text-[var(--text-muted)] line-through`, seguido de um **selo de desconto** `rounded-full px-1.5 py-0.5 text-[11px] font-bold text-white bg-[var(--brand)]` com o texto `-{pct}%`, onde `pct = Math.round((1 - promo_price / price) * 100)`.
   - "Mais vendido" (já existente) continua, agora como selo discreto na mesma linha em vez de texto dourado ao lado do nome.
4. Linha final (só se houver conteúdo): chip de tempo de preparo já existente.

À direita: `<ProductThumb src={product.image_url} name={product.name} size="row" />`.

O botão `+` de adição rápida (comportamento já existente, incluindo abrir o modal quando há grupo obrigatório) passa a ser um botão circular sobreposto ao canto inferior direito da miniatura (`absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[var(--surface)] border border-[var(--border)] shadow-sm grid place-items-center text-[var(--brand)]`), exigindo `relative` no wrapper da miniatura. Manter `motion.button` com `SPRING_TAP` e o `stopPropagation` que já existe.

O coração de favorito continua existindo; movê-lo para o canto superior direito da miniatura, no mesmo padrão sobreposto, mantendo o alvo de toque de 44px já usado hoje (padding + margem negativa) e o `stopPropagation`.

Remover do arquivo o uso de `WINE_GOLD`/`WINE_GOLD_DARK` e a etiqueta de origem (`parseOrigin`) desta linha — a identidade "carta de vinhos" sai. **Não apagar a função `parseOrigin`** sem antes conferir se outro ponto do arquivo ainda a usa; se não usar mais em lugar nenhum, aí sim remover junto.

- [ ] **Passo 2: Miniatura do carrinho**

`CartModal` (`ClientModule.tsx` ~1426-1477) hoje renderiza a miniatura do item com um ícone `Coffee` como fallback — um fallback diferente do resto do app depois desta reescrita. Trocar por `<ProductThumb src={item.product.image_url} name={item.product.name} size="cart" />`, para que a mesma linguagem de fallback valha em todos os pontos. Nada mais no carrinho muda.

- [ ] **Passo 3: Verificação**

1. `npm run build` limpo.
2. Visual: linha com nome/descrição/preço à esquerda e miniatura à direita; produto sem foto mostra o bloco tipográfico, não um vazio; produto com promoção mostra riscado + selo de %; produto com variação mostra "A partir de". No carrinho, a miniatura usa o mesmo bloco (não o ícone de xícara).
3. Funcional: tocar na linha abre o modal; tocar no `+` adiciona direto (ou abre o modal se houver grupo obrigatório); tocar no coração favorita sem abrir o modal.

- [ ] **Passo 4: Commit**
```bash
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): linha de produto com miniatura, selo de desconto e preco na cor da marca"
```

---

### Task 5: Destaques no formato iFood

Reescreve a faixa de destaques (`ClientModule.tsx` ~2473-2524), que hoje reaproveita o próprio `ProductCard` dentro de cartões de 256px.

**Files:**
- Modify: `components/modules/ClientModule.tsx` (bloco de destaques)

**Interfaces:**
- Consome: `ProductThumb` (Task 1), `size="featured"`; `featuredProducts` (já existe, ~2346-2349).

- [ ] **Passo 1: Reescrever**

Título "Destaques" em `text-[19px] font-bold text-[var(--text)]`, sem ícone e sem a régua em degradê dourado de hoje.

Faixa horizontal `overflow-x-auto` com `scroll-snap-type: x mandatory` (manter os degradês de borda que já existem como indicação de que há mais conteúdo). Cada cartão: `w-[165px] flex-shrink-0 scroll-snap-align: start`, contendo, de cima para baixo:
1. `<ProductThumb size="featured" />` (quadrado).
2. Linha de preço `mt-2` — mesma composição da Task 4 (efetivo em `--brand` bold, cheio riscado, selo `-X%`).
3. Nome: `text-[13px] text-[var(--text)] mt-1 line-clamp-2`.

O cartão inteiro é clicável e abre o modal do produto (mesmo handler já usado hoje). **Não** aninhar `ProductCard` dentro do destaque — os dois formatos passam a ser independentes.

- [ ] **Passo 2: Verificação**

1. `npm run build` limpo.
2. Visual: cartões quadrados, rolagem horizontal com encaixe, preço e selo consistentes com a linha da Task 4.
3. Funcional: clicar num destaque abre o modal do produto certo. Loja sem nenhum produto `featured` não renderiza a seção (comportamento atual, preservar).

- [ ] **Passo 3: Commit**
```bash
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): destaques no formato de cartao com foto quadrada"
```

---

### Task 6: Página do produto (modal) no formato iFood

Reescreve `ProductModal` (`ClientModule.tsx` 944-1226).

**Files:**
- Modify: `components/modules/ClientModule.tsx` (`ProductModal`)

**Interfaces:**
- Consome: `ProductThumb` (Task 1), `size="hero"` para o topo e `size="option"` nas opções.

- [ ] **Passo 1: Topo**

Foto sangrando: bloco `h-56 relative`, `<ProductThumb size="hero" />`. Sobre ela, `absolute` no rodapé esquerdo, uma pílula branca com o logo da loja (se houver) + nome da loja em `text-[12px]` — espelhando a referência. Botão de fechar do modal continua onde já está (não duplicar).

- [ ] **Passo 2: Bloco de identificação**

`px-4 pt-4`: nome em `text-[22px] font-bold leading-tight`; descrição em `text-[14px] text-[var(--text-muted)] mt-1`; as `product.tags` já existentes como selos (manter o catálogo de `lib/labels.ts`, trocando o tom dourado por `--brand`); linha de preço com a mesma composição das Tasks 4/5. O coração de favorito continua.

**Não** exibir "Serve até N pessoas" (não existe esse dado no schema — não inventar).

- [ ] **Passo 3: Grupos de opção**

Cada grupo de `product.option_groups` passa a abrir com uma **faixa de cabeçalho** `bg-[var(--surface-2)] px-4 py-2.5 mt-4`:
- Título do grupo em `text-[15px] font-bold text-[var(--text)]`.
- Abaixo, a regra em `text-[12px] text-[var(--text-muted)]`, derivada dos campos que já existem: escolha única → `Escolha 1 opção`; múltipla com `max_select` → `Escolha até {max_select} opções`; múltipla sem máximo → `Escolha quantas quiser`.
- Quando `required`, um selo à direita `bg-[var(--ink)] text-white text-[10px] font-bold tracking-wide rounded px-1.5 py-0.5` com o texto `OBRIGATÓRIO`.

Cada opção vira uma linha `flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]`: nome à esquerda (`text-[14px]`), com o acréscimo abaixo (`+ R$ {price_delta}` em `text-[13px] text-[var(--text-muted)]`, omitido quando o delta é 0); `<ProductThumb size="option" />` à direita; e o controle na ponta direita — para `type='single'`, um rádio circular; para `multiple`, um botão `+` em `--brand`. **Manter os `<input type="radio">`/`<input type="checkbox">` nativos** (visualmente estilizados) e a estrutura `<fieldset>`/`<legend>` com `aria-required` que já existe — a acessibilidade atual não pode regredir. Preservar integralmente: pré-seleção da primeira opção em grupo `single`+`required`, desabilitar ao atingir `max_select`, e o cálculo de `missingRequired`.

- [ ] **Passo 4: Observação e rodapé fixo**

Campo de observação: manter os chips de sugestão já existentes; o campo ganha rótulo "Alguma observação?" com um contador `{n}/140` à direita, `maxLength={140}` e `placeholder="Ex: tirar a cebola, maionese à parte etc."`. **Não** adicionar "Denunciar item" (não existe esse fluxo aqui).

Rodapé fixo dentro do modal (`sticky bottom-0 bg-[var(--surface)] border-t border-[var(--border)] px-4 py-3 flex items-center gap-3`, respeitando `env(safe-area-inset-bottom)`): à esquerda o seletor de quantidade que já existe (`−` / número / `+`, limites 1-99 preservados); à direita, ocupando o resto da largura, o botão "Adicionar" com o total à direita dentro do próprio botão. Preservar o estado desabilitado quando falta grupo obrigatório e a mensagem de erro correspondente.

A seção "Peça também" continua existindo, movida para acima do rodapé fixo, com os cartões usando `ProductThumb size="option"`.

- [ ] **Passo 5: Verificação**

1. `npm run build` limpo.
2. Visual: hero, faixas cinza por grupo, selo OBRIGATÓRIO, rodapé fixo com quantidade + Adicionar.
3. Funcional, um a um: grupo obrigatório bloqueia o botão até escolher; `max_select` desabilita as demais; primeira opção de grupo `single`+`required` já vem marcada; quantidade multiplica o total corretamente; observação entra no pedido; "Peça também" troca o produto do modal; adicionar ao carrinho gera a linha certa (com o dedup por opções funcionando — adicionar o mesmo produto com opções diferentes deve criar duas linhas).
4. Teclado: navegar pelos grupos com Tab, marcar com Espaço/setas, fechar com Esc.

- [ ] **Passo 6: Commit**
```bash
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): pagina do produto com hero, grupos em faixa e rodape fixo"
```

---

## Fora de escopo (registrado para não se perder)

- **Fotos dos produtos.** 0 de 1109 têm foto. Este plano entrega o layout com fallback desenhado; encher o catálogo de fotos é trabalho de conteúdo, não de código. Fotografar os ~20 itens mais vendidos do Sertão dá a maior parte do ganho visual (são os que aparecem em Destaques e no topo das categorias). **Não gerar foto de prato por IA** — é restaurante real vendendo comida real, foto que não corresponde ao prato entregue é problema de direito do consumidor, não de estética.
- **Avaliação agregada por loja** (a linha "4,7 (85 avaliações)" da referência). Existe `order_ratings`, mas é por pedido e hoje está praticamente vazia; e a avaliação só é coletada no fluxo de balcão (limitação já documentada no `AGENTS.md`). Exibir nota exigiria primeiro agregar e cobrir o fluxo de mesa.
- **Cupom / desconto promocional.** Não existe o conceito no schema. Está na lista de standby do `AGENTS.md`.
- **Horário de funcionamento da loja** ("Loja fechada • Abre amanhã às 15:00"). Só existe horário por categoria (`available_from`/`available_until`), não da loja.
- **Login do cliente (Google/celular)**, mencionado na reunião de 2026-08-19 e adiado ali mesmo.
- **Aplicar a mesma linguagem visual ao menu do garçom** (`StoreTableMenu`/`StoreProductModal` em `StoreModule.tsx`), que hoje é uma réplica visual do cardápio antigo. Depois desta reescrita os dois ficam divergentes — vale uma passada própria.
- **Identidade "carta de vinhos"** (dourado + etiqueta de origem + tipografia editorial) sai do cardápio nesta reescrita, em todas as 7 lojas. Isso foi desenhado originalmente para a Vieras e Vinhos, que é literalmente uma loja de vinhos. Se ela precisar manter a identidade própria, o caminho é tema por loja — não existe hoje e não é escopo deste plano.
