import { scheduledPrice, type PriceSchedule } from './priceSchedule';
// Fonte única da fórmula de taxa de serviço e split de conta, antes
// duplicada em 7+ lugares entre StoreModule.tsx e ClientModule.tsx.
// O percentual é configurável por loja (store.config.service_fee_rate);
// SERVICE_FEE_RATE é só o valor padrão pra lojas que ainda não configuraram.
export const SERVICE_FEE_RATE = 0.10;

// Percentual de taxa de serviço da loja (fração: 0,1 = 10%). ÚNICO ponto que lê stores.config.service_fee_rate: comanda,
// caixa, pré-conta, conta do cliente, divisão e fechamento passam por aqui. 0% é válido (loja que não cobra); ausente ou
// inválido (negativo, acima de 100%, texto) cai no padrão de 10%, nunca em NaN na conta.
export function resolveServiceFeeRate(config: { service_fee_rate?: unknown } | null | undefined): number {
  const r = config?.service_fee_rate;
  return typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 1 ? r : SERVICE_FEE_RATE;
}

/** Teto do campo de percentual em Configurações > Geral > Atendimento (o Master Admin pode ir além, até 100%). */
export const TAXA_MAXIMA_PERCENT = 30;

/** Percentual digitado na tela (0 a 30) -> fração gravada em service_fee_rate, com duas casas no percentual. */
export function taxaPercentualParaConfig(percentual: number): number {
  if (!Number.isFinite(percentual)) return SERVICE_FEE_RATE;
  const pct = Math.min(TAXA_MAXIMA_PERCENT, Math.max(0, percentual));
  return Math.round(pct * 100) / 10000;
}

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
export function getEffectivePrice(product: { price: number; promo_price?: number | null; price_schedules?: PriceSchedule[] | null }, now: Date = new Date()): number {
  const promo = product.promo_price;
  const base = promo != null && promo < product.price ? promo : product.price;
  // Preço por horário (migration 153): vale o menor entre o preço-base/promoção e as regras do momento.
  return product.price_schedules && product.price_schedules.length > 0 ? scheduledPrice(base, product.price_schedules, now) : base;
}

// Preço unitário de uma linha do carrinho com adicionais (base + soma dos
// price_delta escolhidos). Centraliza aqui em vez de repetir a soma no
// ProductModal, no CartModal e no cartTotal do ClientModule. Usa
// getEffectivePrice pra que a promoção entre automaticamente em todo cálculo.
export function calculateCartItemUnitPrice(item: { product: { price: number; promo_price?: number | null; price_schedules?: PriceSchedule[] | null }; selectedOptions?: { price_delta: number }[] }): number {
  const addonsTotal = (item.selectedOptions || []).reduce((acc, o) => acc + o.price_delta, 0);
  return getEffectivePrice(item.product) + addonsTotal;
}

// ---------------------------------------------------------------------------
// Preço das opções escolhidas (migration 140) — ESPELHO EXATO do bloco de
// opções de create_order_secure. Mudou um, muda o outro.
//   a) variação: opt.variants[nome de uma opção escolhida em OUTRO grupo]
//      sobrescreve price_delta/omie_codigo (1ª chave que bate na ordem
//      grupo→opção vence);
//   b) pote 'max': opções escolhidas em grupos price_rule='max' — só a de
//      maior acréscimo é cobrada (empate: a 1ª na ordem), as outras viram 0;
//   c) o chamador soma tudo (calculateCartItemUnitPrice).
// Devolve as opções JÁ com o acréscimo efetivo, na ordem (grupo, opção) —
// o mesmo que o servidor grava em order_items.selected_options.
type PricingOption = { id: string; name: string; price_delta: number; omie_codigo?: string | null; variants?: Record<string, { price_delta?: number; omie_codigo?: string | null }> | null };
type PricingGroup = { id: string; price_rule?: 'sum' | 'max'; options: PricingOption[] };

type ChosenOption = { group: PricingGroup; option: PricingOption };

function chosenInOrder(groups: PricingGroup[], selections: Record<string, string[]>): ChosenOption[] {
  // `groups` já vem ordenado (fetchMenu ordena por "order"); dentro do grupo,
  // a ordem é a das opções (não a ordem do clique) — igual ao servidor.
  return groups.flatMap(group => {
    const ids = selections[group.id] || [];
    return group.options.filter(o => ids.includes(o.id)).map(option => ({ group, option }));
  });
}

function resolveVariant(option: PricingOption, groupId: string, chosen: ChosenOption[]): { price_delta: number; omie_codigo: string | null } {
  let price_delta = option.price_delta;
  let omie_codigo = option.omie_codigo ?? null;
  const variants = option.variants;
  if (variants && typeof variants === 'object') {
    const match = chosen.find(c => c.group.id !== groupId && Object.prototype.hasOwnProperty.call(variants, c.option.name));
    const v = match ? variants[match.option.name] : undefined;
    if (v && typeof v === 'object') {
      if (typeof v.price_delta === 'number') price_delta = v.price_delta;
      if (v.omie_codigo !== undefined) omie_codigo = v.omie_codigo ? String(v.omie_codigo).trim() || null : null;
    }
  }
  return { price_delta, omie_codigo };
}

export function resolveSelectedOptions(
  groups: PricingGroup[],
  selections: Record<string, string[]>,
): { group_id: string; option_id: string; name: string; price_delta: number; omie_codigo: string | null }[] {
  const chosen = chosenInOrder(groups, selections);
  const resolved = chosen.map(c => ({ ...c, ...resolveVariant(c.option, c.group.id, chosen) }));

  let maxIdx = -1;
  resolved.forEach((r, i) => {
    if (r.group.price_rule === 'max' && (maxIdx < 0 || r.price_delta > resolved[maxIdx].price_delta)) maxIdx = i;
  });

  return resolved.map((r, i) => ({
    group_id: r.group.id,
    option_id: r.option.id,
    name: r.option.name,
    price_delta: r.group.price_rule === 'max' && i !== maxIdx ? 0 : r.price_delta,
    omie_codigo: r.omie_codigo,
  }));
}

// Acréscimo a MOSTRAR ao lado de uma opção ("+R$ 10"), com a variação já
// resolvida pelas outras escolhas atuais (ex.: sabor Danada mostra +30 na
// Média e +20 na Grande). Não aplica o pote 'max' — é o acréscimo daquele
// sabor, não o que sobra depois de comparar com o outro sabor.
export function displayOptionDelta(
  groups: PricingGroup[],
  selections: Record<string, string[]>,
  groupId: string,
  option: PricingOption,
): number {
  return resolveVariant(option, groupId, chosenInOrder(groups, selections)).price_delta;
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


// Fechar uma mesa sem itens (total 0) não é uma venda: não pode disparar nota fiscal
// nem ordem de produção — a busca automática pegaria o pedido da venda ANTERIOR da
// mesa (janela de 5 min) e emitiria/baixaria estoque de novo. Sem paymentData
// (fluxo antigo) o comportamento não muda.
export const vendaTemCobranca = (paymentData?: { total: number } | null): boolean => {
  if (!paymentData) return true;
  return Number.isFinite(paymentData.total) && paymentData.total > 0;
};

// CMV (Custo de Mercadoria Vendida) — margem bruta por produto ou agregado.
// cost null/undefined = produto sem custo cadastrado → retorna null (não calculável).
// Arredonda marginPct pra 2 casas pra evitar floats sujos no display.
export function calculateMargin(
  revenue: number,
  cost: number | null | undefined,
): { profit: number; marginPct: number } | null {
  if (cost == null) return null;
  const profit = revenue - cost;
  const marginPct = revenue === 0 ? 0 : Math.round((profit / revenue) * 10000) / 100;
  return { profit, marginPct };
}

// Alerta de estoque baixo (migration 142): filtra produtos cujo estoque
// atual está abaixo do threshold configurado. Produtos sem threshold são ignorados.
export function filterLowStockProducts<T extends {
  name: string;
  stock_alert_threshold?: number | null;
  current_stock?: number | null;
}>(products: T[]): T[] {
  return products.filter(p =>
    p.stock_alert_threshold != null &&
    p.current_stock != null &&
    p.current_stock < p.stock_alert_threshold
  );
}

// Prioridade KDS (migration 142): itens prioritários vão pro topo,
// ordenados por created_at DESC (mais recente primeiro).
// Itens normais ficam abaixo, ordenados por created_at ASC (mais antigo primeiro = FIFO).
export function sortKitchenItems<T extends { priority?: boolean; created_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aP = a.priority ? 1 : 0;
    const bP = b.priority ? 1 : 0;
    if (aP !== bP) return bP - aP; // prioritários primeiro
    if (aP === 1) {
      // Entre prioritários: mais recente primeiro
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    // Entre normais: mais antigo primeiro (FIFO)
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

// Comparativo de produtos entre dois períodos (relatórios comparativos, 2026-10-03):
// devolve quem mais cresceu e quem mais caiu em quantidade vendida. Produto sem
// nenhuma venda no período anterior entra como "novo" (sem % de variação).
export interface ProductQty { key: string; name: string; qty: number }
export interface ProductMover { key: string; name: string; current: number; previous: number; delta: number }
export function compareProductQuantities(current: ProductQty[], previous: ProductQty[], limit = 5): { up: ProductMover[]; down: ProductMover[] } {
  const prev = new Map(previous.map(p => [p.key, p]));
  const cur = new Map(current.map(p => [p.key, p]));
  const keys = new Set([...cur.keys(), ...prev.keys()]);
  const all: ProductMover[] = [];
  keys.forEach(key => {
    const c = cur.get(key)?.qty ?? 0;
    const p = prev.get(key)?.qty ?? 0;
    all.push({ key, name: (cur.get(key) ?? prev.get(key))!.name, current: c, previous: p, delta: c - p });
  });
  const up = all.filter(m => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, limit);
  const down = all.filter(m => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, limit);
  return { up, down };
}

// Média de várias estatísticas de dia (comparação "mesmo dia da semana"): total, pedidos, ticket e pedidos de mesa.
// Ignora lista vazia (devolve null). O ticket médio é recalculado do total/pedidos médios, não média de tickets.
export interface DayStats { total: number; count: number; ticket: number; tableOrders: number }
export function averageStats(list: DayStats[]): (DayStats & { days: number }) | null {
  if (list.length === 0) return null;
  const n = list.length;
  const total = Math.round((list.reduce((s, x) => s + x.total, 0) / n) * 100) / 100;
  const count = list.reduce((s, x) => s + x.count, 0) / n;
  const tableOrders = list.reduce((s, x) => s + x.tableOrders, 0) / n;
  const ticket = count > 0 ? Math.round((total / count) * 100) / 100 : 0;
  return { total, count, ticket, tableOrders, days: n };
}
