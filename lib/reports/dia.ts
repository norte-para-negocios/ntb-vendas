// lib/reports/dia.ts — datas do período dos relatórios (puro, sem I/O).
export const hojeISO = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bahia' });

// Início e fim do dia em Bahia (UTC-3, sem horário de verão) como instantes UTC.
export const limitesDoDia = (dia: string): [Date, Date] => [new Date(`${dia}T00:00:00-03:00`), new Date(`${dia}T23:59:59.999-03:00`)];

export function turnosDoPeriodo<T extends { opened_at: string }>(rows: T[], ini: Date, fim: Date): T[] {
  return rows.filter((t) => { const d = new Date(t.opened_at); return d >= ini && d <= fim; });
}
