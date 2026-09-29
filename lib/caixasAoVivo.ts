import type { CashShift, CashShiftHistoryRow } from '@/lib/api';

export type CaixaAberto = CashShift & { operator_name: string | null };
export type OperadorCaixa = { nome: string; aberto: CaixaAberto | null; historico: CashShiftHistoryRow[] };

export const nomeDoOperador = (nome: string | null | undefined): string => nome?.trim() || 'Conta universal';

export function agruparOperadores(abertos: CaixaAberto[], historico: CashShiftHistoryRow[]): OperadorCaixa[] {
  const mapa = new Map<string, OperadorCaixa>();
  const pegar = (nome: string) => {
    let o = mapa.get(nome);
    if (!o) { o = { nome, aberto: null, historico: [] }; mapa.set(nome, o); }
    return o;
  };
  abertos.forEach((s) => { pegar(nomeDoOperador(s.operator_name)).aberto = s; });
  historico.forEach((h) => { pegar(nomeDoOperador(h.operator_name)).historico.push(h); });
  mapa.forEach((o) => o.historico.sort((a, b) => b.opened_at.localeCompare(a.opened_at)));
  return [...mapa.values()].sort((a, b) => {
    if (!!a.aberto !== !!b.aberto) return a.aberto ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

export function tempoAberto(abertoEm: string, agora: number): { horas: number; esquecido: boolean; texto: string } {
  const min = Math.max(0, Math.floor((agora - new Date(abertoEm).getTime()) / 60000));
  const horas = Math.floor(min / 60);
  let texto: string;
  if (horas >= 24) texto = `${Math.floor(horas / 24)} d ${horas % 24} h`;
  else if (horas >= 1) texto = `${horas} h ${String(min % 60).padStart(2, '0')} min`;
  else texto = `${min} min`;
  return { horas, esquecido: horas >= 24, texto };
}

export function podeVerCaixasDaEquipe(user: { role: string; permissions?: Record<string, any> }): boolean {
  return user.role === 'owner' || user.role === 'manager' || user.role === 'universal' || user.permissions?.supervisiona_caixa === true;
}
