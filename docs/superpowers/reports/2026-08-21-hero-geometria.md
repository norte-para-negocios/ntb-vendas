# Correção de geometria do hero da loja — 2026-08-21

**Não visualizado renderizado.** Todo o trabalho abaixo foi feito só editando
código e rodando `npm run build` (compila e passa tipos limpo) — nenhum
navegador foi aberto nesta sessão para conferir visualmente. As medidas
abaixo são cálculo geométrico a partir dos valores de CSS/Tailwind
aplicados, não uma leitura de tela real. Precisam ser conferidas ao vivo.

## Arquivo alterado

`components/modules/ClientModule.tsx` — bloco do hero da loja em
`/c/[slug]` (dentro de `<header className="relative">`, por volta da linha
2946 em diante).

## O que mudou (geometria apenas)

1. **Cartão inset + arredondado nos 4 cantos.** Classe do cartão passou de
   `rounded-t-2xl` (só topo, full-bleed) para `mx-4 ... rounded-2xl`
   (margem horizontal de 1rem/16px de cada lado + 4 cantos arredondados).
   `-mt-4` (sobreposição vertical sobre a capa) foi preservado sem
   alteração, assim como a sombra (`boxShadow: 'var(--shadow-md)'`).

2. **Logo reancorada na borda do cartão, não da capa.** O `<div>` wrapper do
   logo (mesmo padrão de sempre — `absolute`/anel/recorte no wrapper,
   `ProductThumb` cuidando só do próprio conteúdo) deixou de ser filho do
   container da capa (`-bottom-8`, ancorado na base da capa) e passou a ser
   o **primeiro filho do próprio cartão** (`-top-8`, ancorado na borda
   superior do cartão, que já é `position: relative`). Como `top: -2rem`
   com `w-16 h-16` (64px de diâmetro) é exatamente metade da altura do
   círculo, ele fica automaticamente centrado na borda do cartão — metade
   acima (sobre a capa), metade abaixo (sobre o branco do cartão) — sem
   depender de recalcular a altura fixa da capa.

3. **Padding interno do cartão ajustado.** `pt-12` (48px, calculado pra
   quando a logo "vazava" 48px dentro do cartão no esquema antigo) virou
   `pt-10` (40px) — a logo agora só invade 32px do cartão (metade dos
   64px), então `pt-10` deixa ~8px de respiro antes da linha do nome, sem
   colisão e sem sobra vazia grande.

4. **Altura da capa mantida em 200px** (`h-[200px]`, inalterada) — já era
   suficiente pro corte que a inserção do cartão e o arredondamento nos 4
   cantos precisam; nenhuma alteração foi feita aqui.

Nada de conteúdo, ícones, lógica de endereço, divisor, segunda linha,
estado vazio da capa ou botões coração/lupa/tema foi tocado — só as
classes de geometria acima.

## Números esperados (para conferir ao vivo)

Coordenadas verticais relativas ao topo do `<header>` (topo da capa = Y=0),
ignorando `env(safe-area-inset-top)` (que só afeta os botões sobre a capa,
não a geometria abaixo):

| Marco | Y esperado |
|---|---|
| Topo da capa | 0px |
| Base da capa | 200px |
| **Topo do cartão** | **184px** (200 − 16 do `-mt-4`) |
| **Topo do logo** | **152px** (184 − 32) |
| **Base do logo** | **216px** (184 + 32) |

O centro vertical do logo (184px) deve coincidir exatamente com o topo do
cartão — ou seja, **32px do logo (metade dos 64px de diâmetro) devem cair
acima dessa linha (sobre a foto de capa) e os outros 32px devem cair
abaixo dela (sobre o branco do cartão)**, aproximadamente 50/50.

Horizontal: cartão com `mx-4` (16px de margem de cada lado da tela — para
referência, ~4% de um viewport de 390px, dentro da faixa "4-5%" pedida).
Logo centralizada horizontalmente (`left-1/2 -translate-x-1/2`) tanto em
relação ao cartão quanto à tela, já que o cartão é centralizado com margens
iguais.

## Motion

Nenhum novo preset criado. `SPRING_SHEET` (expansão do endereço completo) e
`SPRING_TAP` (usados em outras partes do card, ex. botão "+" do
`ProductCard`) continuam os únicos usados no arquivo — este ajuste não
mexeu em nenhuma animação.

## Preocupações / pontos a validar ao vivo

- A matemática assume `w-16 h-16` (64px) fixo para a logo e `-mt-4`/`-top-8`
  (16px/32px) fixos — todos inalterados nesta correção, herdados do código
  anterior, então o comportamento com/sem `logo_url` e com/sem `cover_url`
  deveria se manter (ambos os estados vazios já eram tratados antes e não
  foram tocados).
- Não há como confirmar visualmente se o `mx-4` (16px) bate perceptualmente
  com a faixa "4-5% da largura da tela" da referência em telas muito
  largas ou muito estreitas — 16px é uma fração maior em telas pequenas
  (>4% em 390px) e menor em telas grandes; ficou fixo em `mx-4` conforme
  sugerido no pedido, não responsivo por breakpoint.
- Vale confirmar visualmente que os 8px de respiro (`pt-10` vs. base
  teórica de 32px) parecem corretos — foi uma escolha de "respiro
  confortável", não um número extraído de medição de tela real.

## Verificação executada

`npm run build` — compilou e passou TypeScript limpo, todas as rotas
geradas normalmente (incluindo `/c/[slug]`). Nenhum outro teste automatizado
existe no projeto.
