// Fonte única da fórmula de taxa de serviço e split de conta, antes
// duplicada em 7+ lugares entre StoreModule.tsx e ClientModule.tsx.
// O percentual é configurável por loja (store.config.service_fee_rate);
// SERVICE_FEE_RATE é só o valor padrão pra lojas que ainda não configuraram.
export const SERVICE_FEE_RATE = 0.10;

export function calculateServiceFee(subtotal: number, rate: number = SERVICE_FEE_RATE): number {
  return subtotal * rate;
}

// Formata a taxa como percentual pra exibição (0.10 -> "10%", 0.125 -> "12,5%").
// Antes disso, cada tela reescrevia `(rate * 100).toFixed(0) + '%'` na hora de
// montar o texto — e o Master Admin permite taxa fracionária
// (`AdminModule.tsx`, `<Input type="number" step="0.1">`), então `.toFixed(0)`
// arredondava e imprimia um percentual que contradizia o valor real cobrado
// (ex.: loja em 12,5% mostrava "13%" ao lado de "R$ 12,50"). Preserva número
// inteiro limpo ("10%") e usa vírgula decimal pt-BR só quando há fração
// ("12,5%"). Centralizado aqui pelo mesmo motivo do resto do arquivo: toda
// exibição de "X%" deriva automaticamente do valor real, sem precisar caçar
// cada call site.
export function formatServiceFeeRate(rate: number): string {
  const pct = Number((rate * 100).toFixed(2));
  const formatted = pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return `${formatted}%`;
}

export function calculateOrderTotal(subtotal: number, chargeServiceFee: boolean, rate: number = SERVICE_FEE_RATE, serviceFeeRemoved?: boolean): number {
  if (!chargeServiceFee || serviceFeeRemoved) return subtotal;
  return subtotal + calculateServiceFee(subtotal, rate);
}

export interface SplitItem {
  userName: string;
  subtotal: number;
}

export function calculateSplitByPerson(items: SplitItem[], chargeServiceFee: boolean, rate: number = SERVICE_FEE_RATE): Map<string, number> {
  const bySubtotal = new Map<string, number>();
  for (const item of items) {
    bySubtotal.set(item.userName, (bySubtotal.get(item.userName) || 0) + item.subtotal);
  }
  const result = new Map<string, number>();
  for (const [name, subtotal] of bySubtotal) {
    result.set(name, calculateOrderTotal(subtotal, chargeServiceFee, rate));
  }
  return result;
}

export function calculateChange(amountPaid: number, total: number): number {
  return Math.max(0, amountPaid - total);
}

// Fix round 2 (Group A2, módulo Caixa): troco de uma conta paga com
// múltiplas formas (`payment_details.methods`). Antes duplicado
// verbatim em StoreModule.tsx (handleFinishPayment) e EstacaoModule.tsx
// (reconcileCaixa) — a mesma classe de drift já documentada pra
// SERVICE_FEE_RATE antes de virar lib/calc.ts, só que aqui na trilha de
// troco, onde divergência significa a tela do caixa e o papel impresso
// discordando sobre quanto dinheiro devolver ao cliente.
//
// Regra (achado real testando conta dividida, ver comentário histórico
// em StoreModule.tsx): troco é sobre o que o DINHEIRO precisava cobrir
// (total menos o que os métodos não-dinheiro já pagaram), nunca sobre o
// total cheio da conta — senão parte-cartão-parte-dinheiro sempre dava
// troco zero.
export function calculateChangeForMethods(
  methods: { method: string; amount: number }[],
  total: number,
): number {
  const cashPaid = methods.filter((m) => m.method === 'CASH').reduce((acc, m) => acc + m.amount, 0);
  const nonCashPaid = methods.filter((m) => m.method !== 'CASH').reduce((acc, m) => acc + m.amount, 0);
  const amountOwedInCash = Math.max(0, total - nonCashPaid);
  return calculateChange(cashPaid, amountOwedInCash);
}

// Achado real (reunião com o Ramon, 2026-08-25): histórico de vendas, nota
// fiscal e cupom impresso podiam mostrar 3 valores DIFERENTES pra mesma
// venda. Causa: `methods` (o mesmo array acima usado pro troco) guarda o
// dinheiro BRUTO entregue pelo cliente — pode ser maior que o devido, de
// propósito, quando o caixa espera dar troco. Esse array vira
// `payment_details.methods` sem ajuste nenhum, e é dele que
// `lib/fiscal/xml.ts` deriva `vOutro`/`vNF` (soma bruta dos métodos) —
// então uma venda de R$41,80 paga com uma nota de R$50 gerava nota fiscal
// de R$50, enquanto o histórico (que lê `payment_details.total`, o valor
// correto) continuava mostrando R$41,80.
//
// Esta função devolve `methods` com o valor de CASH limitado ao que
// realmente cobre a conta (exclui o troco) — nunca deve ser chamada com o
// resultado usado pra imprimir o comprovante do cliente (esse continua
// precisando do valor bruto entregue + troco, ver `payment.methods` em
// printBillReceipt), só para o que vira `payment_details`/base fiscal.
// Métodos não-CASH nunca têm conceito de troco, ficam inalterados. Mais de
// uma entrada de CASH (raro, mas possível): o valor devido em dinheiro é
// distribuído proporcionalmente, com a última entrada absorvendo o resto
// do arredondamento — mesmo princípio já usado em `detPag`/`vOutro` por
// item em lib/fiscal/xml.ts.
export function getPaymentMethodsForRecord<T extends { method: string; amount: number }>(
  methods: T[],
  total: number,
): T[] {
  const nonCashPaid = methods.filter((m) => m.method !== 'CASH').reduce((acc, m) => acc + m.amount, 0);
  const amountOwedInCash = Math.max(0, Number((total - nonCashPaid).toFixed(2)));
  const cashEntries = methods.filter((m) => m.method === 'CASH');
  const cashRawTotal = cashEntries.reduce((acc, m) => acc + m.amount, 0);
  if (cashEntries.length === 0 || cashRawTotal <= amountOwedInCash) return methods;

  let acumulado = 0;
  return methods.map((m) => {
    if (m.method !== 'CASH') return m;
    const isLast = cashEntries.indexOf(m) === cashEntries.length - 1;
    const novoValor = isLast
      ? Number((amountOwedInCash - acumulado).toFixed(2))
      : Number((amountOwedInCash * (m.amount / cashRawTotal)).toFixed(2));
    acumulado += novoValor;
    return { ...m, amount: novoValor };
  });
}

// Preço efetivo de um produto (migration 019): promo_price quando setado E
// menor que o preço cheio, senão price. A guarda `< price` é rede de
// segurança pro client — o CHECK do banco (promo_price < price) e o
// coalesce em create_order_secure já garantem isso no servidor, mas aqui
// evitamos exibir "promoção" que na verdade encareceria o item caso um dado
// inconsistente escape. Fonte única: carrinho, modal e total leem daqui.
export function getEffectivePrice(product: { price: number; promo_price?: number | null }): number {
  const promo = product.promo_price;
  return promo != null && promo < product.price ? promo : product.price;
}

// Preço unitário de uma linha do carrinho com adicionais (base + soma dos
// price_delta escolhidos). Centraliza aqui em vez de repetir a soma no
// ProductModal, no CartModal e no cartTotal do ClientModule. Usa
// getEffectivePrice pra que a promoção entre automaticamente em todo cálculo.
export function calculateCartItemUnitPrice(item: { product: { price: number; promo_price?: number | null }; selectedOptions?: { price_delta: number }[] }): number {
  const addonsTotal = (item.selectedOptions || []).reduce((acc, o) => acc + o.price_delta, 0);
  return getEffectivePrice(item.product) + addonsTotal;
}

export function calculateCartTotal(cart: { product: { price: number; promo_price?: number | null }; quantity: number; selectedOptions?: { price_delta: number }[] }[]): number {
  return cart.reduce((acc, item) => acc + calculateCartItemUnitPrice(item) * item.quantity, 0);
}

// Achado real (usuário, 2026-08-25): "Faturamento Total", o Histórico de
// Vendas inteiro (lista, filtro por valor, ordenação, relatório impresso,
// CSV) e o gráfico de vendas por dia do dashboard estavam TODOS recalculando
// o total de cada venda a partir de `order_items` (price_at_time*quantity)
// ou de `orders.total` — os DOIS são sempre só o valor de PRODUTO, nunca
// incluem a taxa de serviço (create_order_secure/close_table_orders_secure
// nunca escrevem a taxa em nenhum dos dois). Toda venda com taxa de serviço
// cobrada aparecia sistematicamente a menor em QUALQUER lugar que mostrasse
// "quanto essa venda valeu" — não um bug isolado, era o padrão usado em
// pelo menos 9 call sites diferentes.
//
// `payment_details.total` é o valor real, gravado no fechamento (mesa ou
// balcão) já com a taxa de serviço somada — é a mesma fonte que "Detalhes
// da Venda" (StoreModule.tsx) já usa desde a correção anterior. Esta
// function centraliza a mesma regra pra todo o resto: usa
// `payment_details.total` quando existe (toda venda fechada desde a Task 2
// do plano Frente de Caixa / desde `closeTableSession`/`closeCounterOrder`
// gravarem payment_details), cai pro subtotal de itens só pra vendas
// antigas o bastante pra não ter isso gravado — nunca `orders.total`, que
// tem exatamente o mesmo problema que `payment_details.total` resolve.
export function getOrderDisplayTotal(order: {
  payment_details?: { total?: number } | null;
  order_items?: { price_at_time: number; quantity: number; status?: string }[];
}): number {
  if (order.payment_details && typeof order.payment_details.total === 'number') {
    return order.payment_details.total;
  }
  return (order.order_items || [])
    .filter(i => i.status !== 'canceled')
    .reduce((sum, i) => sum + i.price_at_time * i.quantity, 0);
}

// Formatação BRL (vírgula decimal) pra valores em real — antes disso todo
// preço no cardápio do cliente usava `toFixed(2)` puro, que só produz ponto
// ("44.90" em vez de "44,90"). Só o número: o prefixo "R$ " já existe nos
// call sites, não duplicar aqui.
export const formatBRL = (n: number): string =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
