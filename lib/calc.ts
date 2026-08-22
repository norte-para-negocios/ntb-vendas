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

// Formatação BRL (vírgula decimal) pra valores em real — antes disso todo
// preço no cardápio do cliente usava `toFixed(2)` puro, que só produz ponto
// ("44.90" em vez de "44,90"). Só o número: o prefixo "R$ " já existe nos
// call sites, não duplicar aqui.
export const formatBRL = (n: number): string =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
