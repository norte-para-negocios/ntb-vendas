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
