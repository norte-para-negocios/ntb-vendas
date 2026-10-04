// Filtros combináveis do histórico de vendas (relatórios, 2026-10-04). Todos os filtros ativos se combinam (E).
import type { Order } from '@/types';
import { getPaymentMethodLabel } from '../labels';
import { localDayAndMinutes } from '../priceSchedule';

export interface SalesFilters {
  operator: string;
  method: string;
  brand: string;
  table: string;
  status: 'all' | 'delivered' | 'canceled';
  invoice: 'all' | 'with' | 'without';
  hourFrom: string;
  hourTo: string;
}

export const EMPTY_FILTERS: SalesFilters = { operator: '', method: '', brand: '', table: '', status: 'all', invoice: 'all', hourFrom: '', hourTo: '' };

const toMinutes = (t: string): number => { const [h, m] = t.split(':'); return Number(h) * 60 + Number(m || 0); };

export function applySalesFilters(orders: Order[], f: SalesFilters): Order[] {
  return orders.filter((o) => {
    const pd = (o.payment_details ?? null) as { operador_nome?: string; emitir_nota?: boolean; methods?: { method: string; brand?: string }[] } | null;
    const methods = Array.isArray(pd?.methods) ? pd!.methods! : [];
    if (f.operator && pd?.operador_nome !== f.operator) return false;
    if (f.method && !methods.some((m) => m.method === f.method)) return false;
    if (f.brand && !methods.some((m) => m.brand === f.brand)) return false;
    if (f.table && String((o as any).tables?.number ?? '') !== f.table) return false;
    if (f.status !== 'all' && o.status !== f.status) return false;
    if (f.invoice === 'with' && pd?.emitir_nota !== true) return false;
    if (f.invoice === 'without' && !(pd && pd.emitir_nota === false)) return false;
    if (f.hourFrom || f.hourTo) {
      const { minutes } = localDayAndMinutes(new Date(o.created_at), 'America/Bahia');
      if (f.hourFrom && minutes < toMinutes(f.hourFrom)) return false;
      if (f.hourTo && minutes > toMinutes(f.hourTo)) return false;
    }
    return true;
  });
}

export function describeFilters(f: SalesFilters): { key: keyof SalesFilters; label: string }[] {
  const chips: { key: keyof SalesFilters; label: string }[] = [];
  if (f.operator) chips.push({ key: 'operator', label: `Operador: ${f.operator}` });
  if (f.method) chips.push({ key: 'method', label: `Forma: ${getPaymentMethodLabel(f.method)}` });
  if (f.brand) chips.push({ key: 'brand', label: `Bandeira: ${f.brand}` });
  if (f.table) chips.push({ key: 'table', label: `Mesa ${f.table}` });
  if (f.status !== 'all') chips.push({ key: 'status', label: f.status === 'canceled' ? 'Canceladas' : 'Entregues' });
  if (f.invoice !== 'all') chips.push({ key: 'invoice', label: f.invoice === 'with' ? 'Com nota' : 'Sem nota' });
  if (f.hourFrom || f.hourTo) chips.push({ key: 'hourFrom', label: `Horário ${f.hourFrom || '00:00'}–${f.hourTo || '23:59'}` });
  return chips;
}

export const activeFilterCount = (f: SalesFilters): number => describeFilters(f).length;
