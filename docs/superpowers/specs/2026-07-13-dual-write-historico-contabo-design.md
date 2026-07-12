# Dual-write de vendas para histórico completo no Contabo

Data: 2026-07-13
Status: aprovado ("se você acha que tá legal, pode ir")

## Contexto

O `ntb-estoque-next` já tem uma arquitetura de histórico completo no servidor Contabo
(dual-write + cópia + leitura híbrida), motivada por um banco Supabase perto do limite
do free tier. O `ntb-vendas` é um projeto irmão (cardápio digital + pedidos de mesa,
7 lojas reais em produção desde fevereiro/2026), mas está numa situação bem diferente:
banco em 14MB, 272 pedidos e 655 itens em 5 meses — sem nenhuma pressão de espaço hoje
nem no médio prazo.

Ainda assim, o usuário quer o mesmo princípio aplicado aqui: **nunca perder o histórico
de vendas**, por consistência entre os dois projetos e como seguro de longo prazo,
independente de o Supabase algum dia precisar de poda.

## Decisão de arquitetura

### Escopo: só dual-write + cópia. Sem leitura híbrida nem poda por enquanto.

Como não há plano de remover nada do Supabase aqui, um módulo de leitura híbrida
(`lib/historico-contabo.ts` equivalente) não mudaria nenhum comportamento observável
hoje — o Supabase sempre vai ter o dado completo. Construir isso agora seria trabalho
sem benefício prático. Fica documentado como fase futura, a ser retomada só se o volume
crescer a ponto de justificar podar o Supabase (mesmo gatilho que motivou o
`ntb-estoque-next`).

### Onde interceptar a escrita

`orders`/`order_items` são gravadas por RPCs Postgres (`security definer`) chamadas
direto do browser — não existe hoje nenhuma rota de servidor no momento da *criação*
do pedido. O único ponto server-side que já existe e já tem o pedido completo em mãos
é `app/api/integracao/ordem-producao/route.ts`, que roda exatamente quando o pedido
**fecha** (`status = 'delivered'`, disparado por `closeCounterOrder`/`closeTableSession`
em `lib/api.ts`), já lendo `orders` + `order_items` (com join em `products` para
`omie_codigo`) pra integrar com o Omie.

Isso é o ponto certo: pedidos só viram venda de fato quando fecham — rascunho em
andamento (`pending`/`accepted`/`preparing`) não precisa de histórico permanente.
O dual-write entra logo depois que a rota já resolveu `orderIds`/itens (reaproveita a
mesma query, não faz uma nova), como uma chamada fire-and-forget adicional — mesmo
princípio de risco zero que a integração com o Omie já usa ali (erro nunca impede o
fechamento do pedido).

### Onde o dado fica no Contabo

Banco novo no mesmo servidor Contabo (`185.193.66.240`, já pago, já em uso pelo
`ntb-estoque-next`): `ntb_vendas_frio`, separado do `ntb_frio` do estoque — são
domínios de negócio diferentes, sem motivo para misturar. Reaproveita a mesma API HTTP
(`ntb-frio-api`, já rodando via systemd) com um segundo `Pool` de conexão e endpoints
novos com prefixo `/vendas/`: `POST /vendas/orders` (recebe o pedido completo + itens
num único payload, grava numa transação).

Tabelas no Contabo espelham o schema do Supabase:
- `orders`: `id, table_id, store_id, status, order_type, total, customer_name, payment_method, payment_details, created_at, updated_at`
- `order_items`: `id, order_id, product_id, quantity, status, notes, price_at_time, selected_options, created_at, store_id`

### Cópia do histórico já existente

Os 272 pedidos/655 itens já existentes no Supabase são copiados uma vez pro Contabo
(mesmo script `copiar-tabelas.mjs` já usado no `ntb-estoque-next`, adaptado pro Postgres
do `ntb_vendas_frio`), pra não começar o histórico com um buraco desde fevereiro/2026.

## Segurança

- Nenhuma leitura existente do `ntb-vendas` é tocada — só adiciona escrita nova.
- A chamada pro Contabo nunca bloqueia nem quebra o fechamento do pedido nem a
  integração com o Omie — sempre fire-and-forget com `.catch()`.
- Chave secreta da API do Contabo nunca commitada — variável de ambiente
  (`NTB_FRIO_API_URL`/`NTB_FRIO_API_KEY`, mesmo padrão do `ntb-estoque-next`, valores
  próprios pro `ntb-vendas` já que aponta pra um banco diferente).
- Não mexe no banco `ntb_frio` nem na API existente além de adicionar as rotas novas.

## Riscos

- Pedidos cancelados (`canceled`) antes de fechar nunca chegam ao Contabo — aceitável,
  não são venda.
- Se o volume de `ntb-vendas` crescer rápido no futuro (novas lojas reais), a decisão de
  não construir leitura híbrida agora precisa ser revisitada antes que o Supabase deste
  projeto chegue perto do limite do free tier — documentado aqui para não ser esquecido.
