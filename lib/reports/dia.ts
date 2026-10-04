// lib/reports/dia.ts — datas do período dos relatórios (puro, sem I/O).
export const hojeISO = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bahia' });

// Início e fim do dia em Bahia (UTC-3, sem horário de verão) como instantes UTC.
export const limitesDoDia = (dia: string): [Date, Date] => [new Date(`${dia}T00:00:00-03:00`), new Date(`${dia}T23:59:59.999-03:00`)];

type TurnoLike = { opened_at: string; closed_at?: string | null };

// Turno que SE SOBREPÕE ao período: abriu até o fim e (ainda está aberto ou fechou depois do início).
// Cobre o turno que vira a noite e o que foi esquecido aberto. Cada turno aparece uma única vez.
export function turnosDoPeriodo<T extends TurnoLike>(rows: T[], ini: Date, fim: Date): T[] {
  return rows.filter((t) => {
    if (new Date(t.opened_at) > fim) return false;
    return !t.closed_at || new Date(t.closed_at) >= ini;
  });
}

// Turno que sai do período (abriu antes do início, ou continua depois do fim): o resumo dele cobre mais do que o período,
// então os totais do relatório usam só as vendas do período ligadas a esse turno.
export function turnoParcial(t: TurnoLike, ini: Date, fim: Date): boolean {
  return new Date(t.opened_at) < ini || !t.closed_at || new Date(t.closed_at) > fim;
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
