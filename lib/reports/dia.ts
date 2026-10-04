// lib/reports/dia.ts — datas do período dos relatórios (puro, sem I/O).
export const hojeISO = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bahia' });

// Início e fim do dia em Bahia (UTC-3, sem horário de verão) como instantes UTC.
export const limitesDoDia = (dia: string): [Date, Date] => [new Date(`${dia}T00:00:00-03:00`), new Date(`${dia}T23:59:59.999-03:00`)];

export function turnosDoPeriodo<T extends { opened_at: string }>(rows: T[], ini: Date, fim: Date): T[] {
  return rows.filter((t) => { const d = new Date(t.opened_at); return d >= ini && d <= fim; });
}

// Intervalo de dias (início do dia `de` até o fim do dia `ate`), no máximo 31 dias.
export function limitesDoPeriodo(de: string, ate: string): [Date, Date] {
  const [ini] = limitesDoDia(de);
  const [, fim] = limitesDoDia(ate);
  const dias = Math.round((fim.getTime() - ini.getTime()) / 86_400_000);
  if (!(fim > ini) || dias > 31) throw new Error('periodo-invalido');
  return [ini, fim];
}
export const rotuloPeriodo = (de: string, ate: string): string => {
  const f = (d: string) => new Date(`${d}T12:00:00-03:00`).toLocaleDateString('pt-BR');
  return de === ate ? f(de) : `${f(de)} a ${f(ate)}`;
};
