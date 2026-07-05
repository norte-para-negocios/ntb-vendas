import { Category } from '@/types';

// Cardapio por horario/turno (migration 018): uma categoria inteira pode
// ficar restrita a uma janela de horario e/ou dias da semana (ex.: "Cafe
// da Manha" das 07:00 as 11:00). NULL em qualquer um dos 3 campos = sem
// restricao naquele eixo; os 3 null/undefined = categoria sempre
// disponivel. Enforcement e' 100% client-side (decisao explicita, ver
// AGENTS.md — mesmo principio ja usado pro required/min/max de
// adicionais: nao ha valor financeiro em jogo).

type ScheduleFields = Pick<Category, 'available_from' | 'available_until' | 'available_days'>;

const DAY_LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// Aceita "HH:MM" ou "HH:MM:SS" (formato que o Postgres `time` costuma
// devolver via Postgrest) — segundos sao ignorados, comparacao e' por
// hora:minuto.
function timeStringToMinutes(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes || 0);
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':');
  return `${hours.padStart(2, '0')}:${(minutes || '00').padStart(2, '0')}`;
}

export function isCategoryAvailableNow(category: ScheduleFields, now: Date = new Date()): boolean {
  const { available_from, available_until, available_days } = category;

  if (available_days && available_days.length > 0 && !available_days.includes(now.getDay())) {
    return false;
  }

  if (available_from && available_until) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const fromMinutes = timeStringToMinutes(available_from);
    const untilMinutes = timeStringToMinutes(available_until);

    if (untilMinutes < fromMinutes) {
      // Janela vira a meia-noite (ex.: 23:00 ate 03:00): disponivel se
      // ainda nao passou da meia-noite (now >= from) OU ja passou (now <=
      // until do dia seguinte).
      if (nowMinutes < fromMinutes && nowMinutes > untilMinutes) return false;
    } else {
      if (nowMinutes < fromMinutes || nowMinutes > untilMinutes) return false;
    }
  }

  return true;
}

// String pronta pra UI do lojista (badge no chip da categoria) e, se
// quiser, do cliente. `null` = sem nenhuma restricao configurada.
export function formatScheduleLabel(category: ScheduleFields): string | null {
  const { available_from, available_until, available_days } = category;

  const hasTimeWindow = Boolean(available_from && available_until);
  const hasDayFilter = Boolean(available_days && available_days.length > 0);

  if (!hasTimeWindow && !hasDayFilter) return null;

  const timeLabel = hasTimeWindow ? `das ${formatTime(available_from!)} às ${formatTime(available_until!)}` : null;
  const daysLabel = hasDayFilter
    ? [...available_days!].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(', ')
    : null;

  if (timeLabel && daysLabel) return `Disponível ${timeLabel} (${daysLabel})`;
  if (timeLabel) return `Disponível ${timeLabel}`;
  return `Disponível ${daysLabel}`;
}
