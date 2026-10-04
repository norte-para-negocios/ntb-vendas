// lib/reports/shiftSales.ts
import type { Order } from '@/types';

export function salesOfShift(orders: Order[], shiftId: string, method?: string): Order[] {
  if (!shiftId) return [];
  return orders.filter((o) => {
    const pd = o.payment_details as { cash_shift_id?: string; methods?: { method: string }[] } | null;
    if (pd?.cash_shift_id !== shiftId) return false;
    return !method || (Array.isArray(pd.methods) && pd.methods.some((m) => m.method === method));
  });
}
