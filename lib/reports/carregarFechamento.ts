// lib/reports/carregarFechamento.ts — busca tudo do dia (as mesmas funções de sempre) e devolve FechamentoData.
import { fetchCashShiftsHistory, fetchCashShiftSummary, fetchSalesHistory, fetchExceptionsReport, fetchMenu } from '../api';
import { limitesDoDia, turnosDoPeriodo } from './dia';
import type { FechamentoData, FechamentoTurno } from './fechamentoXlsx';

export async function carregarFechamento(p: { storeId: string; storeName: string; userName: string; dia: string }): Promise<FechamentoData> {
  const [ini, fim] = limitesDoDia(p.dia);
  const [turnosRows, vendas, exc, menu] = await Promise.all([
    fetchCashShiftsHistory(p.storeId, 200),
    fetchSalesHistory(p.storeId, ini.toISOString(), fim.toISOString()),
    fetchExceptionsReport(p.storeId, ini, fim),
    fetchMenu(p.storeId, false, true),
  ]);
  const turnos: FechamentoTurno[] = [];
  for (const t of turnosDoPeriodo(turnosRows, ini, fim)) {
    // eslint-disable-next-line no-await-in-loop -- poucos turnos por dia
    const resumo = await fetchCashShiftSummary(t.id);
    if (resumo) turnos.push({ operador: t.operator_name ?? 'Equipe', abertoEm: t.opened_at, fechadoEm: t.closed_at, fundo: Number(t.opening_float), contado: t.closing_counted_cash, resumo });
  }
  const nomes = new Map(menu.categories.map((c) => [c.id, c.name]));
  return {
    loja: p.storeName, periodoLabel: new Date(`${p.dia}T12:00:00-03:00`).toLocaleDateString('pt-BR'), geradoEm: new Date(), geradoPor: p.userName,
    turnos, vendas, excecoes: exc.events, nomeCategoria: (id) => nomes.get(id),
  };
}
