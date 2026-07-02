// Fonte única da fórmula de taxa de serviço e split de conta — antes
// duplicada em 7+ lugares entre StoreModule.tsx e ClientModule.tsx.
// Percentual ainda é fixo em 10% (torná-lo configurável por loja é a
// feature "taxa de serviço configurável" do backlog de produto — fora
// de escopo desta correção).
export const SERVICE_FEE_RATE = 0.10;

export function calculateServiceFee(subtotal: number): number {
  return subtotal * SERVICE_FEE_RATE;
}

export function calculateOrderTotal(subtotal: number, chargeServiceFee: boolean, serviceFeeRemoved?: boolean): number {
  if (!chargeServiceFee || serviceFeeRemoved) return subtotal;
  return subtotal + calculateServiceFee(subtotal);
}

export interface SplitItem {
  userName: string;
  subtotal: number;
}

export function calculateSplitByPerson(items: SplitItem[], chargeServiceFee: boolean): Map<string, number> {
  const bySubtotal = new Map<string, number>();
  for (const item of items) {
    bySubtotal.set(item.userName, (bySubtotal.get(item.userName) || 0) + item.subtotal);
  }
  const result = new Map<string, number>();
  for (const [name, subtotal] of bySubtotal) {
    result.set(name, calculateOrderTotal(subtotal, chargeServiceFee));
  }
  return result;
}

export function calculateChange(amountPaid: number, total: number): number {
  return Math.max(0, amountPaid - total);
}
