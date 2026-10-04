// lib/reports/groupSales.ts
import type { Order } from '@/types';
import { getPaymentMethodLabel } from '../labels';
import { localDayAndMinutes } from '../priceSchedule';

export type GroupBy = 'hour' | 'operator' | 'category' | 'method';
export interface GroupRow { key: string; label: string; total: number; orders: number; ticket: number }

type Pd = { operador_nome?: string; methods?: { method: string; amount: number }[] } | null;
const receivedOf = (o: Order): number => {
  const m = (o.payment_details as Pd)?.methods;
  return Array.isArray(m) ? m.reduce((s, x) => s + Number(x.amount), 0) : 0;
};

export function groupSales(orders: Order[], by: GroupBy): GroupRow[] {
  const acc = new Map<string, { label: string; cents: number; orders: number }>();
  const add = (key: string, label: string, value: number, count: number) => {
    const cur = acc.get(key) ?? { label, cents: 0, orders: 0 };
    cur.cents += Math.round(value * 100);
    cur.orders += count;
    acc.set(key, cur);
  };

  // Uma conta (mesa/pedido + mesmo pagamento) conta uma vez, mesmo com vários pedidos.
  const seen = new Set<string>();
  orders.filter((o) => o.status !== 'canceled').forEach((o) => {
    if (by === 'category') {
      (o.order_items ?? []).filter((i) => i.status !== ('canceled' as never)).forEach((i) => {
        const cid = i.product?.category_id ?? '_sem';
        add(cid, cid === '_sem' ? 'Sem categoria' : cid, Number(i.price_at_time) * i.quantity, 0);
      });
      return;
    }
    const pd = o.payment_details as Pd;
    const conta = `${o.table_id ?? o.id}|${JSON.stringify(pd?.methods ?? [])}`;
    if (seen.has(conta)) return;
    seen.add(conta);
    const valor = receivedOf(o);
    if (by === 'hour') {
      const h = Math.floor(localDayAndMinutes(new Date(o.created_at), 'America/Bahia').minutes / 60);
      add(String(h).padStart(2, '0'), `${h}h`, valor, 1);
    } else if (by === 'operator') {
      const nome = pd?.operador_nome || 'Sem operador';
      add(nome, nome, valor, 1);
    } else {
      (pd?.methods ?? []).forEach((m) => add(m.method, getPaymentMethodLabel(m.method), Number(m.amount), 1));
    }
  });

  const rows: GroupRow[] = Array.from(acc.entries()).map(([key, v]) => {
    const total = v.cents / 100;
    return { key, label: v.label, total, orders: v.orders, ticket: v.orders > 0 ? Math.round((total / v.orders) * 100) / 100 : 0 };
  });
  return by === 'hour' ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows.sort((a, b) => b.total - a.total);
}
