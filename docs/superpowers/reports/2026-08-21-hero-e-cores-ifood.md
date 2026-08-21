# Correção do hero + paleta iFood — 2026-08-21

Rodada de correção sobre o redesign iFood do cardápio do cliente
(`components/modules/ClientModule.tsx`), a partir de feedback direto do
usuário no resultado já publicado. **Não visualizado renderizado** — sem
acesso a navegador nesta sessão; a verificação foi `npm run build` (passou
limpo) + leitura cuidadosa de cada trecho alterado. O controlador vai
dirigir a UI ao vivo depois.

## Contexto operante

Medido em produção: a loja piloto tem 390 produtos ativos com 0 descrições,
0 fotos, 0 preços promocionais, e a própria loja não tem logo nem capa. Ou
seja, todo slot visual do layout iFood está vazio hoje — e é exatamente
isso que motiva os itens 1 e 2: o estado vazio precisa ser desenhado e
reservar espaço, nunca colapsar.

## Item 1 — Hero sempre 200px, estado vazio desenhado

**O quê:** a faixa da capa (`<header>` → primeiro `<div>` dentro dele,
`ClientModule.tsx`) agora é sempre `h-[200px]`, com capa ou sem. Removida a
lógica condicional `currentStore.cover_url ? 'h-[200px]' : 'h-[120px]'` que
uma rodada anterior tinha introduzido.

Sem `cover_url`, em vez do antigo degradê plano `--ink→--brand`, a faixa
agora tem: o mesmo degradê de marca como base + uma textura de pontos
sutil (`radial-gradient` repetido, 16px, branco a 14% de opacidade) + um
glifo de câmera/foto (`Image` de `lucide-react`, aliasado `ImageIcon` pra
não colidir com o `Image` do `next/image`) centralizado a 15% de opacidade
(`text-white/15`). O overlay escuro (`rgba(0,0,0,.18)→.55`, usado só pra
dar contraste aos controles sobre uma FOTO real) **não é aplicado** nesse
branch — era exatamente esse overlay incondicional que a rodada anterior
tinha deixado, e que deixava o estado vazio parecendo um buraco preto.

**Por que estou convencido:** a faixa agora sempre ocupa o mesmo espaço
visual entre ter e não ter capa — o usuário consegue ver a forma do design
(onde a foto vai entrar) mesmo com a loja 100% vazia, que era o pedido
explícito ("quero ver a estrutura mesmo sem upload nada"). O glifo/textura
tornam esse espaço legível como "slot de foto" em vez de um degradê genérico
qualquer, sem competir visualmente com os controles (ThemeToggle/Sair, que
continuam com `bg-black/35` — testado contra os dois fundos, capa+overlay
escuro OU degradê de marca sem overlay, ambos suficientemente escuros pra
manter os ícones brancos legíveis).

## Item 2 — Logo circular sempre presente

**O quê:** o círculo de 64px que cruza a borda inferior da capa
(`ring-4 ring-[var(--surface)]`) agora renderiza sempre, não só quando
`store.logo_url` existe. Trocado o `<Image>` condicional por
`<ProductThumb src={currentStore.logo_url} name={currentStore.name}
size="store" className="absolute left-4 -bottom-8 z-10 ring-4
ring-[var(--surface)]" />`.

Adicionado um novo tamanho `store` ao `SIZES` de `components/ProductThumb.tsx`
(`{ box: 'w-16 h-16 rounded-full', text: 'text-[26px]', px: 64 }`) — **reusei
o componente `ProductThumb` diretamente**, em vez de duplicar a lógica de
hash/hue/gradiente (`hueFromName`, `initials`, as classes
`product-thumb-fallback`/`product-thumb-fallback-text` do `globals.css`) num
terceiro lugar. A única mudança necessária no componente foi essa nova
entrada de tamanho (circular em vez dos cantos arredondados que os outros
tamanhos usam) — o resto do componente (branch com/sem `src`, cálculo de
hue, iniciais) já era genérico o bastante pra caber sem nenhuma outra
alteração.

O cartão de identificação da loja logo abaixo (`pt-12`/`pt-4` condicional a
`currentStore.logo_url`) virou `pt-12` fixo, já que o logo (real ou
placeholder) sempre ocupa aquele espaço agora — não há mais estado "sem
logo" que precise de menos padding.

**Por que estou convencido:** "reusar o componente em vez de mirroring" era
a preferência explícita do brief quando possível, e aqui foi possível de
forma limpa — `ProductThumb` já era parametrizado por tamanho, só faltava um
tamanho circular. O resultado visual do fallback (cor derivada de hash do
nome da loja, inicial grande) é literalmente o mesmo tratamento já usado em
toda miniatura de produto sem foto, então a UI fica coerente consigo mesma
em vez de inventar uma quarta identidade visual de "placeholder".

## Item 3 — Paleta iFood (ação vermelha / promoção roxa / preço normal escuro)

**O quê:** duas constantes novas perto do topo do arquivo, mesmo precedente
de `WINE_GOLD`:

```
const IFOOD_RED = '#EA1D2C';
const IFOOD_PURPLE = '#8E1CA8';
```

Aplicadas via `style={{ ... }}` (não classes Tailwind arbitrárias, já que
Tailwind não referencia variável JS em tempo de build — o mesmo motivo pelo
qual `WINE_GOLD` também é sempre usado assim, nunca como classe) em cada
elemento nomeado no brief:

- **Ação → vermelho:** o `+` de adição rápida no `ProductCard` (linha do
  cardápio), o botão "Adicionar" no rodapé do `ProductModal` (via
  `style={{ backgroundColor: IFOOD_RED }}` sobre o `<Button>` compartilhado —
  não mexi no componente `Button` em si, que é usado pelo lojista/Master
  Admin também: só esta instância recebe a cor, por `style`, que sempre
  vence a classe `bg-[var(--brand)]` do variant `primary`), o sublinhado da
  aba de categoria ativa (`border-[var(--brand)]` → `style={{ borderColor:
  IFOOD_RED }}` condicional a `isActive`), e o radio/checkbox de opção
  dentro dos grupos de adicional (`ProductModal`, tanto `type='single'`
  quanto `type='multiple'`).
- **Preço normal (sem promoção) → texto escuro em negrito, `var(--text)`,
  nunca colorido.** Reescrevi `PriceRow` (a função central de composição de
  preço, já reusada por `ProductCard`, `FeaturedProductCard` e
  `ProductModal`) pra usar `color: promo ? IFOOD_PURPLE : 'var(--text)'` em
  vez do antigo `text-[var(--brand)]` fixo. Como a loja piloto tem 0
  `promo_price`, isso significa que hoje praticamente **todo** preço do
  cardápio vira texto escuro — que é exatamente o comportamento correto
  segundo a referência real do iFood (cor só aparece em item com
  promoção/Clube).
- **Preço promocional + selo `-X%` → roxo, `IFOOD_PURPLE`.** Mesma
  `PriceRow`, dentro do branch `promo && pct !== null`.
- Também apliquei a mesma regra normal/promo (sem passar pela `PriceRow`,
  que é dimensionada demais pro card compacto) no preço do card "Peça
  também" (antes hardcoded `text-[var(--brand)]`, agora
  `hasActivePromo(rec) ? IFOOD_PURPLE : 'var(--text)'`) — senão esse preço
  ficaria teimosamente azul depois da troca de paleta, contradizendo o
  pedido do usuário bem ao lado de um preço já corrigido.
- O total da barra flutuante do carrinho (antes `var(--brand)`) virou texto
  branco simples — **não** `var(--text)`: essa barra é um cartão de vidro
  escuro (`text-white`, rótulos vizinhos em `text-white/80`/`50`), e
  `var(--text)` é escuro no tema claro — aplicá-lo ali seria ilegível.
  Branco simples é o equivalente correto de "preço não-colorido" nesse
  contexto específico (documentado inline no código).

**O que eu deliberadamente NÃO toquei**, por não estar no escopo nomeado do
item 3 e pra não arriscar inconsistência de julgamento: os botões-pílula de
favoritos/ordenação na barra de busca (continuam `bg-[var(--brand)]` quando
ativos), o ícone/fundo do sacola na barra flutuante do carrinho, o botão
"Ver Comanda" (leva pro `CartModal`, que está congelado), o
`CounterConfirmModal`, e tudo dentro de `CartModal`/`OrderStatusModal`/
`BillSplitter` (explicitamente "devem ficar visualmente inalterados" no
brief) — nenhum desses foi mencionado nominalmente no item 3, e mexer
neles ampliaria escopo sem pedido explícito.

**Por que estou convencido:** apliquei a cor exatamente nos 4 controles de
ação nomeados (quick-add, Adicionar, aba ativa, radio/+ de opção) e nos 2
estados de preço descritos (normal/promo), sem generalizar pra elementos
não nomeados. O token global `--brand` não foi tocado em nenhum arquivo —
só constantes locais novas em `ClientModule.tsx`, aplicadas via `style`
inline nos pontos exatos, preservando o painel do lojista e o Master Admin
(que usam o mesmo `Button`/`--brand` em outros arquivos, intocados).

## Item 4 — Remoção da tipografia monoespaçada (`num`) dos preços

**O quê:** removida a classe `num` de todo elemento de preço dentro do
caminho do cliente que eu efetivamente toquei nesta rodada: `PriceRow`
(preço efetivo + preço riscado), o `+ R$ X` de acréscimo de opção no
`ProductModal`, o total dentro do botão "Adicionar", e o preço do card
"Peça também". **Não** removida em `CartModal`/`OrderStatusModal`/
`BillSplitter` (fora de escopo/congelados nesta rodada) nem em nenhum
arquivo do lojista/documentos impressos — a instrução era explícita sobre
isso ("only the customer cardápio path — don't touch the lojista panel or
printed documents") e esses três componentes específicos foram
explicitamente marcados como "devem ficar visualmente inalterados", então
tratei sua tipografia monoespaçada como parte do que precisa continuar
igual.

**Por que estou convencido:** os preços que o usuário efetivamente vê ao
navegar/abrir um produto/adicionar ao carrinho (a imensa maioria das
interações reais do cardápio) agora usam a fonte sans proporcional em
negrito, igual à referência do iFood — sem tocar em nenhum lugar do
projeto onde alinhamento tabular genuinamente importa (painel do lojista,
impressão térmica/A4).

## Verificação (1ª rodada)

`npm run build` — compilou limpo, TypeScript sem erros, todas as rotas
geradas normalmente (incluindo `/c/[slug]`). Não há suíte de testes neste
repositório. **Não visualizei o resultado renderizado** — nenhum acesso a
navegador nesta sessão; a revisão foi 100% por leitura de código + build.

## Correção pós-revisão ao vivo — item 2 estava quebrado

O coordenador dirigiu o resultado num navegador real e confirmou itens 1,
3 e 4 corretos (hero 200px com textura+glifo lendo como "aqui vai a foto",
sublinhado de aba e `+` vermelhos, preços em sans proporcional escuro).
**Item 2 estava quebrado**: o círculo da logo renderizava no fluxo normal,
canto superior-esquerdo da capa, em vez de cruzar a borda inferior.

**Causa raiz** (medida ao vivo pelo coordenador, confirmada lendo o
código): o `className` passado ao `ProductThumb` incluía `absolute
left-4 -bottom-8 z-10 ring-4 ring-[var(--surface)]`, mas o próprio
template raiz do `ProductThumb` já embute `relative` incondicionalmente —
resultado, o elemento final carregava **as duas classes ao mesmo tempo**
(`relative` E `absolute`). Como as duas são utilitárias de mesma
especificidade CSS, quem vence não é a ordem no atributo `class`, é a
ordem das regras na folha de estilo que o Tailwind gera — e `relative`
vencia, deixando `left-4`/`-bottom-8` inertes. Consequência em cascata: com
o logo fora do lugar, o `pt-12` do cartão de nome (que reserva espaço
vertical exato pro logo cruzar a borda) sobrava como uma faixa vazia.

**Por que o `relative` está lá**: não é um acidente nem um resquício —
o branch com `src` de `ProductThumb` usa `<Image fill>`, que **exige** um
ancestral posicionado pra se dimensionar (senão a foto de produto colapsa
pra 0×0). É a mesma razão pela qual funciona normalmente nos outros 6
lugares que chamam `ProductThumb` hoje (linha de produto, card de
destaque, foto do `ProductModal`, opção de adicional, "Peça também",
miniatura do carrinho) — **nenhum deles passa classe de posição**, todos
só passam `size` (e um só, tamanho via `!w-full !h-16 !rounded-none`).
Então o `relative` nunca tinha conflitado com nada antes desta chamada ser
a primeira a tentar posicionar o componente pai de fora.

**Fix aplicado** (`components/modules/ClientModule.tsx`, mesmo trecho do
hero): removido o `className` de posição do `ProductThumb` e envolvido
numa `<div>` externa que é quem recebe `absolute left-4 -bottom-8 z-10
w-16 h-16 rounded-full overflow-hidden ring-4 ring-[var(--surface)]`. O
`ProductThumb` volta a só cuidar do próprio conteúdo (foto ou fallback),
sem que o pai precise "furar" o `relative` interno dele.

```tsx
<div className="absolute left-4 -bottom-8 z-10 w-16 h-16 rounded-full overflow-hidden ring-4 ring-[var(--surface)]">
    <ProductThumb src={currentStore.logo_url} name={currentStore.name} size="store" />
</div>
```

**Geometria esperada, verificada por conta (capa 200px, `-bottom-8` =
-32px, círculo 64px):** topo do logo = 200 − 64 + 32 = 168; fundo do logo
= 200 + 32 = **232**, exatamente `cover bottom + 32` como o coordenador
pediu pra confirmar. O cartão de nome começa em `top: 184` (`-mt-4` sobre
`top: 200`) e reserva `pt-12` (48px) até `184 + 48 = 232` — bate
exatamente com o fundo do logo, sem gap nem sobreposição de conteúdo.

**Sobre não remover o `relative` hardcoded do `ProductThumb`**: decisão
deliberada, não omissão. Ele é necessário internamente pro `fill` do
`next/image` funcionar em TODO caller atual, e nenhum dos outros 6 call
sites hoje precisa (nem tenta) posicionar o componente de fora — só este
novo (`size="store"` no hero) precisava, e a solução (wrapper externo) não
exige nenhuma mudança de contrato do componente. Trocar o `relative`
hardcoded por uma prop opcional seria mudança de API sem nenhum consumidor
pedindo — deixei documentado inline no próprio JSX do hero (comentário
extenso no local exato) pra qualquer sessão futura que for tocar
`ProductThumb` de novo já saber por que o `relative` está lá e por que a
posição deve continuar sendo responsabilidade do wrapper externo, nunca do
`className` passado ao componente.

## Verificação (2ª rodada, pós-correção)

`npm run build` — compilou limpo de novo, TypeScript sem erros, mesmas 16
rotas geradas (incluindo `/c/[slug]`). Itens 1/3/4 não foram tocados nesta
rodada. **Ainda não visualizei o resultado renderizado eu mesmo** — a
correção foi validada por leitura de código + cálculo manual da geometria
esperada + build; a confirmação visual definitiva é do coordenador, que
vai dirigir a UI de novo.
