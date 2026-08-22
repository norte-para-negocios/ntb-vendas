# Subprojeto A — Correções rápidas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consertar cinco defeitos independentes que hoje atrapalham a operação das 7 lojas — o mais grave sendo que **a impressão nunca funcionou em nenhuma delas**.

**Architecture:** Cinco correções sem dependência entre si, em 4 arquivos. Nenhuma mexe em pedido, preço, carrinho, RPC ou fluxo fiscal. Não há schema novo, não há migration.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4, Supabase Postgres.

**Spec:** Não existe documento de design separado. A fonte é o backlog levantado com o usuário em 2026-08-21/22 (`docs/backlog-2026-08-21-garcom-caixa.md`), itens 11, 14 e 16 mais o bug de impressão, todos confirmados ao vivo por investigação direta nesta sessão.

---

## Global Constraints

- **Sem suíte de testes automatizada** neste repo (`package.json` só tem `dev`/`build`/`start`/`lint`). Cada task usa `npm run build` mais verificação descrita passo a passo. Não pular a verificação — só o formato dela é diferente do template padrão.
- **Dois bancos.** Nenhuma task deste plano mexe em banco, então não há migration nem `notify pgrst`. Se alguma task precisar disso, é sinal de que saiu do escopo — parar e reportar.
- **Motion:** só `SPRING_TAP` / `SPRING_SHEET` de `lib/motion.ts`. O cabeçalho daquele arquivo diz que os dois foram validados visualmente com o usuário e que um terceiro não se cria sem o mesmo processo.
- **Cores:** usar os tokens de `app/globals.css` e as constantes `IFOOD_RED` / `IFOOD_PURPLE` já definidas em `ClientModule.tsx`. Não editar o token global `--brand`.
- **Não quebrar o que já foi verificado ao vivo:** pré-seleção da primeira opção em grupo `single`+`required`, recálculo do total ao trocar opção, matemática da quantidade, `input[type=radio]`/`checkbox` nativos dentro de `<fieldset>`/`<legend>` com `aria-required`, a reserva de rolagem do rodapé fixo, o scroll-spy das abas e sua supressão no clique.
- **Deploy é manual** e não faz parte de nenhuma task: `git push` + `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-vendas && bash deploy.sh"`.

---

### Task 1: Fazer a impressão voltar a funcionar (comanda e relatório)

**O bug, confirmado e reproduzido no navegador:** `lib/print.ts` abre a janela de impressão em dois lugares — linha 44 (`openThermalPrint`, comanda/ticket) e linha 176 (`printSalesReport`, relatório A4) — assim:

```js
const printWindow = window.open('', '_blank', 'width=300,height=500,noopener');
if (!printWindow) return;
```

`noopener` faz `window.open()` **retornar `null` por especificação** — é o que corta o vínculo com a janela criada. A linha seguinte então sai da função em silêncio: sem imprimir, sem erro, sem aviso. Reproduzido ao vivo: com `noopener` → `null`; sem → janela abre normal. Isso vale para as 7 lojas e explica exatamente o relato "nem comanda, nem relatório".

**Por que NÃO basta apagar a palavra:** o `noopener` está ali por segurança. Os documentos são montados com `document.write()` e o campo de observação é texto livre digitado pelo cliente — sem isolamento havia XSS armazenado de verdade, já documentado no `AGENTS.md` (seção "Impressão"). A correção precisa manter o escape **e** o isolamento.

**Files:**
- Modify: `lib/print.ts` (`openThermalPrint` ~linha 43-60; `printSalesReport` ~linha 170-176)

**Interfaces:**
- Consome: `escapeHtml` (já existe no arquivo, continua obrigatório em todo texto livre).
- Produz: nenhuma assinatura pública muda. `printKitchenTicket`, `printBillReceipt` e `printSalesReport` mantêm exatamente os mesmos parâmetros — nenhum call site em `StoreModule.tsx` deve precisar de alteração.

- [ ] **Passo 1: Trocar o mecanismo por iframe oculto**

Substituir a abertura de janela por um `<iframe>` invisível anexado ao documento, escrever o HTML nele, chamar `print()` no `contentWindow` e remover o iframe depois. Isso mantém o conteúdo fora do documento principal (o isolamento que o `noopener` buscava), não depende de bloqueador de pop-up, e imprime.

Pontos obrigatórios da implementação:
- `iframe` com `style` que o tire do fluxo e da vista (posição absoluta fora da tela ou tamanho zero), **nunca** `display:none` — vários navegadores não imprimem iframe com `display:none`.
- Escrever o HTML via `contentDocument.write()` + `close()`, como hoje.
- Chamar `print()` só depois do conteúdo pronto (o código atual usa `setTimeout` de 500ms; manter uma espera equivalente ou usar o evento de load do iframe, que é mais correto).
- Remover o iframe do DOM ao final, sem deixar acúmulo se o usuário imprimir várias vezes seguidas.
- `sandbox` **não** pode bloquear a impressão — se usar, precisa permitir o necessário; na dúvida, não usar `sandbox` e confiar no `escapeHtml`, que é o que já protege hoje.

Aplicar o mesmo mecanismo nos DOIS pontos. Se a estrutura ficar igual, extrair uma função interna única e usá-la nos dois — evita que um seja corrigido e o outro não numa próxima mudança.

- [ ] **Passo 2: Verificação**

1. `npm run build` limpo.
2. Em `npm run dev`, no painel do lojista: abrir uma mesa com item, mandar imprimir a comanda — **a janela/diálogo de impressão precisa aparecer**. Depois, no Histórico de Vendas, imprimir o relatório — idem.
3. Confirmar que nada ficou preso no DOM: imprimir 3 vezes seguidas e verificar no inspetor que não sobraram iframes.
4. Confirmar que o escape continua valendo: lançar um item com observação contendo `<b>teste</b>` e conferir que o documento impresso mostra o texto literal, não negrito.

- [ ] **Passo 3: Commit**
```bash
git add lib/print.ts
git commit -m "fix(impressao): troca window.open com noopener por iframe oculto — impressao nunca funcionou"
```

---

### Task 2: Janela de pedido em tamanho de tela no painel do lojista

O `Modal` compartilhado (`components/ui.tsx`) usa `w-full max-w-md` — **448px fixos**, independente do tamanho da tela. Foi desenhado para o cardápio do cliente (celular) e reaproveitado no painel do lojista, que roda em computador e tablet no salão. Pedido do usuário: quando o garçom ou o caixa cria um pedido, a janela deve ocupar **pelo menos 75% da tela**, sem cobrir 100%, mantendo a sensação de camada sobreposta.

**Files:**
- Modify: `components/ui.tsx` (`Modal`)
- Modify: `components/modules/StoreModule.tsx` (os modais do fluxo de pedido do garçom/caixa)

**Interfaces:**
- Produz: uma prop nova e opcional de largura no `Modal` (ex.: `size?: 'sm' | 'lg'`, default `'sm'` = comportamento atual). **O default preserva byte a byte o que existe hoje** — nenhum call site atual muda de aparência sem optar.

- [ ] **Passo 1: Largura opcional no `Modal`**

Adicionar a prop com default que mantém `max-w-md`. A variante grande deve mirar ~75-80% da largura da viewport com um teto para telas muito largas (para não virar uma faixa esticada em monitor de 27"), e continuar respeitando o `max-h-[90vh]` que já existe. Em telas pequenas, a variante grande deve degradar para largura cheia — o painel também é aberto em tablet.

- [ ] **Passo 2: Aplicar só nos modais do fluxo de pedido do lojista**

Localizar em `StoreModule.tsx` os modais do fluxo de lançar item na comanda (`StoreTableMenu` / `StoreProductModal`) e passar a variante grande. **Não** aplicar no cardápio do cliente (`ClientModule.tsx`), onde 448px está correto, nem em modais de confirmação curtos, onde uma janela enorme piora.

- [ ] **Passo 3: Verificação**

1. `npm run build` limpo.
2. Em `npm run dev`, no painel do lojista em janela de desktop: abrir o fluxo de lançar item — a janela deve ocupar a maior parte da tela, com o fundo ainda visível nas bordas.
3. Reduzir a janela para largura de tablet e depois de celular — a janela não pode estourar a tela nem ficar com rolagem horizontal.
4. Abrir o cardápio do cliente e confirmar que **nada** mudou lá.

- [ ] **Passo 4: Commit**
```bash
git add components/ui.tsx components/modules/StoreModule.tsx
git commit -m "feat(lojista): janela de pedido em tamanho de tela no painel, cardapio do cliente inalterado"
```

---

### Task 3: Deixar a taxa de serviço explícita

A taxa de serviço é **opcional para o consumidor** e precisa estar informada antes do pedido. Hoje ela só aparece no cartão da loja no cardápio **quando está ligada** — quando está desligada não aparece nada, o que é ambíguo.

**Files:**
- Modify: `components/modules/ClientModule.tsx` (cartão da loja no hero; comanda/conta do cliente)
- Modify: `components/modules/StoreModule.tsx` (comanda da mesa vista pelo garçom)
- Modify: `lib/print.ts` (`printBillReceipt`)

**Interfaces:**
- Consome: `SERVICE_FEE_RATE` e `calculateOrderTotal` de `lib/calc.ts` — a taxa **nunca** pode ser recalculada inline; aquele arquivo é a fonte única (o `AGENTS.md` registra que a fórmula já esteve duplicada em 7+ lugares).
- Consome: `store.config.charge_service_fee` e `store.config.service_fee_rate`.

- [ ] **Passo 1: Enunciar os dois estados**

Onde hoje a linha só aparece com a taxa ligada, passar a enunciar os dois casos de forma curta e sem ambiguidade — cobrando, dizer que cobra e quanto; não cobrando, dizer que não cobra. O texto deve deixar claro que é **opcional**, porque é o que a lei prevê e é o que protege o lojista.

Aplicar em: cartão da loja no cardápio, comanda/conta vista pelo cliente, comanda da mesa no painel do lojista, e o comprovante impresso (`printBillReceipt`).

- [ ] **Passo 2: Preservar a remoção por mesa**

Já existe a possibilidade de **remover a taxa de uma mesa específica** (`service_fee_removed` / `removedServiceFees`). Isso está correto e é o direito do cliente — não pode ser removido, e quando a taxa foi retirada daquela mesa o texto precisa refletir isso, não continuar dizendo que cobra.

- [ ] **Passo 3: Verificação**

1. `npm run build` limpo.
2. Numa loja com a taxa **ligada** (por exemplo Donana Vilas): a informação aparece no cardápio, na conta e no comprovante, com o percentual certo vindo da configuração da loja.
3. Numa loja com a taxa **desligada** (hoje o Sertão): aparece a informação de que não há taxa — não fica em branco.
4. Remover a taxa de uma mesa e conferir que os textos passam a refletir a retirada.

- [ ] **Passo 4: Commit**
```bash
git add components/modules/ClientModule.tsx components/modules/StoreModule.tsx lib/print.ts
git commit -m "feat(taxa): informa explicitamente se a taxa de servico esta sendo cobrada ou nao"
```

---

### Task 4: Botão "sair" vira "pedir a conta" quando há pedido em aberto

**Investigado:** `handleLogout(false)` (`ClientModule.tsx` ~2548) **não fecha a mesa nem a conta** — só limpa a sessão local (localStorage + estado); a própria confirmação diz *"Se você for o anfitrião, a mesa continuará aberta."* Além disso faz `setMesaOrderIds([])` e `setTrackedOrderId(null)`, então o cliente **perde o acompanhamento dos próprios pedidos** enquanto continua devendo.

**Decisão do usuário (2026-08-22):** com pedido em aberto, o botão passa a ser **"Pedir a conta"**; sem nenhum pedido, continua "Sair".

**Files:**
- Modify: `components/modules/ClientModule.tsx` (o controle no hero, ~3040, e `handleLogout`)

**Interfaces:**
- Consome: o estado de pedidos da mesa já existente (`mesaOrders` / `mesaOrderIds`, via `useMesaOrders`) para saber se há pedido em aberto. **Não recomputar** — usar a mesma derivação que já alimenta a barra de status da sessão.
- Consome: a ação de pedir a conta que **já existe** no cardápio (a que leva a mesa para `waiting_bill`). Não criar uma segunda.

- [ ] **Passo 1: Trocar a ação conforme o estado**

Quando houver pedido em aberto na sessão: o controle vira "Pedir a conta" e dispara a ação já existente. Quando não houver: continua "Sair", com o comportamento atual intacto.

O rótulo "Sair" também deve deixar de sugerir que fecha a mesa — o texto de confirmação já diz que a mesa continua aberta, mas o botão em si precisa ser honesto sobre o que faz (sair deste aparelho).

- [ ] **Passo 2: Verificação**

1. `npm run build` limpo.
2. Abrir mesa, **sem pedir nada**: o controle mostra "Sair" e funciona como hoje.
3. Lançar um item: o controle passa a mostrar "Pedir a conta"; acionar leva a mesa ao estado de conta pedida — o mesmo que o cliente já conseguia pelo caminho normal.
4. Confirmar que o caminho existente de pedir a conta continua funcionando e que não existem dois mecanismos concorrentes.

- [ ] **Passo 3: Commit**
```bash
git add components/modules/ClientModule.tsx
git commit -m "feat(cardapio): botao vira 'pedir a conta' quando ha pedido em aberto"
```

---

### Task 5: Corrigir o cuscuz na categoria errada

Achado no cruzamento do cardápio impresso (`SVM 0001 26 A Menu Port.pdf`) com o catálogo: **"Cuscuz Carne de Sertão" (R$ 24,90) está na categoria "Entradas - Caldos"**, junto dos três caldos. No cardápio impresso ele pertence a Cuscuz.

**Files:**
- Nenhum arquivo de código. É correção de dado.

- [ ] **Passo 1: Mover o produto**

Mover "Cuscuz Carne de Sertão" da categoria "Entradas - Caldos" para "Entradas - Cuscuz", na loja O Sertão Vai Virar Mar.

**Isto é dado de produção do cliente.** Fazer pelo painel do lojista (Cardápio → editar produto → trocar categoria) e **não** por SQL direto, para que a alteração passe pelo mesmo caminho que o lojista usaria e fique consistente com qualquer efeito colateral da aplicação.

- [ ] **Passo 2: Verificação**

Abrir o cardápio do cliente e confirmar que o item aparece em Cuscuz e não em Caldos, e que "Entradas - Caldos" ficou com os 3 caldos do cardápio impresso.

---

## Fora de escopo (registrado, não fazer neste plano)

- **Produtos faltando e gramaturas divergentes** achados no cruzamento com o cardápio impresso — Bolinho de Charque/Peixe/Queijo ausentes; Salada de Camarão e de Salmão ausentes; Sarapatel de Carneiro ausente; Carne do Sol e Carne Defumada na chapa com 500g no sistema contra 600g no cardápio; 10 abarás/acarajés no sistema que não estão no cardápio; Arrumadinho/Escondidinho sem escolha de recheio. **Tudo isso precisa de confirmação do Ramon antes de mexer** — é o cardápio real da loja, e alguns podem ser intencionais (item fora de linha, cardápio desatualizado).
- **Impressão remota** (pedido sai na cozinha, conta sai no caixa): é o subprojeto B, precisa de desenho e de decisão de hardware. Esta Task 1 só devolve a impressão **no aparelho de quem clica**, que é o que as outras 6 lojas usam hoje.
- **Módulo Caixa, jurisdição de mesas, PIN rotativo, perfis de loja por módulos, relatórios**: subprojetos C, D e E.
- **Painel de saúde das integrações** — os três achados silenciosos desta sessão (CSC de produção, impressão, chave de integração vencida) mostram que não há como ninguém perceber que algo parou. Item próprio, ainda sem desenho.
