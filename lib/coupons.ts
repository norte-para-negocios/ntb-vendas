// Cupom de desconto (migration 142/143) — validação pura + cálculo.
// A validação contra o banco (existe? ativo? dentro da validade? usos restantes?)
// acontece na API route / RPC; aqui só a matemática.
export type CouponType = 'percent' | 'fixed';
export interface CouponInfo {
  type: CouponType;
  value: number;
}
/**
 * Calcula o valor do desconto arredondado pra 2 casas.
 * - percent: value% do total (ex.: 10 → 10% de R$ 100 = R$ 10)
 * - fixed: valor fixo em R$, limitado ao total (nunca negativo)
 */
export function calculateCouponDiscount(coupon: CouponInfo, orderTotal: number): number {
  if (orderTotal <= 0) return 0;
  if (coupon.type === 'percent') {
    return Math.round(orderTotal * coupon.value / 100 * 100) / 100;
  }
  // fixed — limita ao total pra não ficar negativo
  return Math.min(Math.round(coupon.value * 100) / 100, orderTotal);
}