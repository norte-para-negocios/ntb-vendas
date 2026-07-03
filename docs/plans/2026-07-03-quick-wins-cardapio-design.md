# Quick wins do cardápio (sub-projeto 1 do Mega Plano)

Data: 2026-07-03
Status: aprovado, aguardando plano de implementação

## Contexto

Depois da feature "Meu Link / QR Code", o usuário pediu pra avançar no
resto do backlog de produto (`docs/VARREDURA-2026-07-02.md`, 15 itens),
cortando o item #14 (integração com o Norte Estoque, tratada à parte). O
escopo restante (14 itens, esforço de Baixo a Alto) foi decomposto em
sub-projetos. Este documento cobre só o primeiro: os 4 itens de menor
esforço e sem dependência entre si nem com o resto da lista.

- **#1** Taxa de serviço configurável por loja (hoje fixa em 10% no código).
- **#2** Exportar relatório de vendas em CSV, além do já existente A4/impressão.
- **#3** Comparação "vs. período anterior" no dashboard do lojista.
- **#4** Avaliação pós-refeição (estrelas + comentário opcional).

Os outros sub-projetos (identidade do cliente, delivery/retirada,
dashboard cross-loja, cupom/fidelidade/LGPD, multi-idioma, push
notification, CMV, reserva de mesa) ficam fora deste documento, ver "Fora
de escopo".

## #1 Taxa de serviço configurável por loja

**Local:** `store.config` (JSONB já existente em `Store`, tipo em
`types/index.ts:37-42`) ganha o campo opcional `service_fee_rate?: number`
(decimal, ex. `0.10` = 10%). Editável pelo Master Admin no modal "Editar
Loja" (`AdminModule.tsx`), no mesmo bloco onde já configura contrato e
número de mesas.

**Comportamento:** `lib/calc.ts` deixa de usar a constante fixa
`SERVICE_FEE_RATE = 0.10` internamente. `calculateServiceFee`,
`calculateOrderTotal` e `calculateSplitByPerson` passam a receber a taxa
como parâmetro (`rate: number`), em vez de lerem a constante. Cada um dos
~12 pontos de chamada em `StoreModule.tsx`/`ClientModule.tsx` passa a
calcular `const serviceFeeRate = store.config.service_fee_rate ?? 0.10;`
(ou a variável `store`/`currentStore` já em escopo em cada ponto) e
repassar esse valor. Lojas que nunca tiverem esse campo definido continuam
se comportando exatamente como hoje (10%), sem migração de dado
necessária.

**UI do form:** um `Input type="number"` (min 0, max 100, step 0.1) rotulado
"Taxa de Serviço (%)" no modal de edição de loja, convertendo de/para
decimal só na hora de salvar (usuário digita "10", grava-se "0.10").

## #2 Exportar CSV

**Local:** botão "Exportar CSV" ao lado do já existente "Imprimir
Relatório" no Histórico de Vendas (`StoreAdminView` em `StoreModule.tsx`,
perto de `handlePrintReport`).

**Comportamento:** reaproveita exatamente o mesmo array já montado pro
`printSalesReport` (mesmas colunas: data, tipo, cliente/mesa, itens,
total; mesmo filtro de período/tipo/valor já aplicado na tela). Gera uma
string CSV (separador `;`, já que é o padrão que o Excel em pt-BR espera
sem confundir o separador decimal) e dispara o download via `Blob` +
`<a download>` (mesmo padrão já usado no botão de baixar QR Code).

**Erros e casos de borda:** lista vazia (nenhuma venda no filtro atual)
gera um CSV só com o cabeçalho, não trava nem gera arquivo corrompido.

## #3 Comparação "vs. período anterior" no dashboard

**Local:** `StoreDashboardView.tsx`, seção "Por Período".

**Comportamento:** pra cada `periodType` já existente (`today`, `week`,
`month`, `year`, `custom` com `periodDays`), calcula o período anterior
correspondente e deslocado pra trás:
- `today` → ontem (`subDays(now, 1)`, `isSameDay`).
- `week` → semana passada (`subDays(now, 7)`, `isSameWeek`).
- `month` → mês passado (`subMonths(now, 1)`, `isSameMonth`).
- `year` → ano passado (ano civil anterior).
- `custom` → os `periodDays` dias imediatamente antes da janela atual
  (`periodStartDate` até `subDays(periodStartDate, periodDays)`).

Roda `calcStats` (já existente) nesse período anterior, calcula a
variação percentual (`(atual - anterior) / anterior * 100`, tratando
`anterior === 0` como "sem comparação" em vez de divisão por zero) e
mostra ao lado de "Total no Período", "Ticket Médio" e "Número de
Pedidos": uma seta (`TrendingUp`/`TrendingDown` do lucide-react, já
importado) + percentual, verde se subiu e vermelho se caiu.

## #4 Avaliação pós-refeição

**Modelo de dados:** nova tabela `order_ratings` (migration
`013_order_ratings.sql`): `id uuid pk`, `order_id uuid references orders
on delete cascade`, `store_id uuid references stores on delete cascade`,
`stars smallint check (stars between 1 and 5) not null`, `comment text`,
`created_at timestamptz default now()`. RLS `allow_all_anon` (mesmo
padrão de `orders`/`order_items`, não é dado sensível, não precisa do
padrão write-only usado no certificado/PIN). Índice em `store_id` pra o
dashboard do lojista buscar rápido.

**Local:** tela "Pedido Finalizado" do `OrderTracker`
(`ClientModule.tsx`, bloco `isDelivered`, onde já existe "Obrigado pela
preferência!").

**Comportamento:** abaixo da mensagem de agradecimento, aparecem 5
estrelas clicáveis + um campo de comentário opcional (só aparece depois
de escolher pelo menos 1 estrela) + botão "Enviar" + link "Pular",
sempre visível. O countdown de redirecionamento automático
(`secondsToRedirect`) que já existe continua rodando em paralelo; enviar
ou pular a avaliação não precisa cancelá-lo, já que o formulário é rápido
o bastante pra caber na mesma janela de tempo. Depois de enviar (ou
pular), grava uma flag em `localStorage`
(`rated_table_${tableId}`) pra não pedir de novo caso a mesma mesa gere
outro pedido "Pedido Finalizado" na mesma visita (uma mesa pode ter
vários pedidos numa única sessão).

**UI do lojista:** nova seção "Avaliações" no `StoreDashboardView.tsx`
(dentro de "Por Período", que já filtra por período): média de estrelas
do período + lista dos comentários mais recentes (paginação simples, 10
por vez, igual ao padrão já usado no Histórico de Vendas).

**Erros e casos de borda:** enviar sem escolher estrela nenhuma não é
permitido (botão "Enviar" fica desabilitado até escolher ao menos 1
estrela); falha de rede ao enviar mostra toast de erro mas não impede o
"Pular"/o countdown de continuar.

## Testes

Sem suite automatizada neste projeto (convenção já estabelecida). Para
cada item: `npx tsc --noEmit` + `npm run build` limpos, teste manual na
loja "Bistrô Demo" (nunca em loja real de cliente):
- #1: mudar a taxa da Bistrô Demo pra 15% no Master Admin, conferir que
  um pedido novo cobra 15% e não 10%; conferir que outra loja sem o campo
  definido continua em 10%.
- #2: exportar CSV com filtro aplicado, abrir no Excel/Google Sheets,
  conferir que os valores batem com o que aparece na tela e no PDF.
- #3: criar (via `scripts/db.mjs`) vendas de teste em dois períodos
  vizinhos e conferir que a variação percentual mostrada bate com a conta
  manual.
- #4: completar um pedido de teste, avaliar com estrelas + comentário,
  conferir que aparece na seção "Avaliações" do dashboard; testar "Pular"
  e confirmar que não trava nada; testar um segundo pedido na mesma mesa
  e confirmar que não pede avaliação de novo.

## Fora de escopo

Os outros 10 itens do backlog (identidade do cliente por telefone, cupom
de desconto, delivery/retirada, multi-idioma, notificação push real,
programa de fidelidade, dashboard cross-loja pro Master Admin, CMV por
produto, reserva de mesa antecipada, LGPD) e a integração com o Norte
Estoque (item #14, cortada pelo usuário) ficam para sub-projetos
seguintes, cada um com seu próprio ciclo de spec e plano.
