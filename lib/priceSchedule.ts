// Preço por horário / happy hour (migration 153). Mesma regra de public.effective_product_price:
// o menor entre o preço-base e as regras ativas que casam com o dia/horário (no fuso da regra).
export interface PriceSchedule {
  id: string;
  name: string;
  product_id: string | null;
  category_id: string | null;
  price: number | null;
  discount_percent: number | null;
  days: number[] | null; // 0=domingo..6=sábado; null = todos
  time_from: string; // 'HH:MM' ou 'HH:MM:SS'
  time_until: string;
  timezone: string;
  active: boolean;
}

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m || 0);
};

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localDayAndMinutes(now: Date, timeZone: string): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour')) % 24; // alguns ambientes devolvem '24' à meia-noite
  return { dow: DOW[get('weekday')] ?? 0, minutes: hour * 60 + Number(get('minute')) };
}

export function scheduleApplies(s: PriceSchedule, now: Date): boolean {
  if (!s.active) return false;
  const { dow, minutes } = localDayAndMinutes(now, s.timezone || 'America/Bahia');
  const from = toMinutes(s.time_from);
  const until = toMinutes(s.time_until);
  const dayOk = (d: number) => !s.days || s.days.length === 0 || s.days.includes(d);
  if (from <= until) return minutes >= from && minutes < until && dayOk(dow);
  // vira a meia-noite: depois da meia-noite vale o dia em que a janela começou
  return (minutes >= from && dayOk(dow)) || (minutes < until && dayOk((dow + 6) % 7));
}

export function scheduledPrice(base: number, schedules: PriceSchedule[] | undefined | null, now: Date = new Date()): number {
  let best = base;
  for (const s of schedules ?? []) {
    if (!scheduleApplies(s, now)) continue;
    const candidate = s.price != null ? Number(s.price) : Math.round(base * (100 - Number(s.discount_percent ?? 0))) / 100;
    if (candidate < best) best = candidate;
  }
  return best;
}
