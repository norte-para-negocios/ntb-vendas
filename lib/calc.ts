// Fonte única da fórmula de taxa de serviço e split de conta, antes
// duplicada em 7+ lugares entre StoreModule.tsx e ClientModule.tsx.
// O percentual é configurável por loja (store.config.service_fee_rate);
// SERVICE_FEE_RATE é só o valor padrão pra lojas que ainda não configuraram.
export const SERVICE_FEE_RATE = 0.10;

export function calculateServiceFee(subtotal: number, rate: number = SERVICE_FEE_RATE): number {
  return subtotal * rate;
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
