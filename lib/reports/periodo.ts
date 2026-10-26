// Período dos relatórios completos (25/10/2026): atalhos, período anterior para comparar e lista de dias.
// Datas 'YYYY-MM-DD' sempre no fuso da Bahia (UTC-3, sem horário de verão). Puro, sem I/O.
export type PresetPeriodo = 'hoje' | 'ontem' | '7d' | '30d' | 'mes' | 'mes_passado' | 'personalizado';

export const MAX_DIAS_PERIODO = 366;
const DIA_MS = 86_400_000;

const diaBahia = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Bahia' });
const meioDia = (dia: string) => new Date(`${dia}T12:00:00-03:00`);
const somarDias = (dia: string, n: number) => diaBahia(new Date(meioDia(dia).getTime() + n * DIA_MS));
const fmt = (dia: string) => meioDia(dia).toLocaleDateString('pt-BR');

export const rotuloDoPeriodo = (de: string, ate: string): string => (de === ate ? fmt(de) : `${fmt(de)} a ${fmt(ate)}`);

export function periodoDoPreset(p: PresetPeriodo, agora: Date, de?: string, ate?: string): { de: string; ate: string; rotulo: string } {
  const hoje = diaBahia(agora);
  const [ano, mes] = hoje.split('-').map(Number);
  let r: { de: string; ate: string; rotulo: string };
  switch (p) {
    case 'hoje': r = { de: hoje, ate: hoje, rotulo: 'Hoje' }; break;
    case 'ontem': { const o = somarDias(hoje, -1); r = { de: o, ate: o, rotulo: 'Ontem' }; break; }
    case '7d': r = { de: somarDias(hoje, -6), ate: hoje, rotulo: 'Últimos 7 dias' }; break;
    case '30d': r = { de: somarDias(hoje, -29), ate: hoje, rotulo: 'Últimos 30 dias' }; break;
    case 'mes': r = { de: `${hoje.slice(0, 8)}01`, ate: hoje, rotulo: 'Este mês' }; break;
    case 'mes_passado': {
      const a = mes === 1 ? ano - 1 : ano; const m = mes === 1 ? 12 : mes - 1;
      const ini = `${a}-${String(m).padStart(2, '0')}-01`;
      r = { de: ini, ate: somarDias(`${hoje.slice(0, 8)}01`, -1), rotulo: 'Mês passado' };
      break;
    }
    default: {
      const d = de || hoje; const t = ate || d;
      r = { de: d, ate: t, rotulo: rotuloDoPeriodo(d, t) };
    }
  }
  return r;
}

export function diasDoPeriodo(de: string, ate: string): string[] {
  const n = Math.round((meioDia(ate).getTime() - meioDia(de).getTime()) / DIA_MS) + 1;
  if (n < 1) throw new Error('periodo-invertido');
  if (n > MAX_DIAS_PERIODO) throw new Error('periodo-longo');
  return Array.from({ length: n }, (_, i) => somarDias(de, i));
}

/** Mesmo número de dias, imediatamente antes (para "comparado ao período anterior"). */
export function periodoAnterior(de: string, ate: string): { de: string; ate: string } {
  const n = diasDoPeriodo(de, ate).length;
  return { de: somarDias(de, -n), ate: somarDias(de, -1) };
}
