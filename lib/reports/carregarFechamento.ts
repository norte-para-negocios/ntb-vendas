// lib/reports/carregarFechamento.ts — busca tudo do dia (as mesmas funções de sempre) e devolve FechamentoData.
import { fetchCashShiftsHistory, fetchCashShiftSummary, fetchSalesHistory, fetchExceptionsReport, fetchMenu } from '../api';
import { limitesDoDia, limitesDoPeriodo, rotuloPeriodo, turnosDoPeriodo } from './dia';
import type { FechamentoData, FechamentoTurno } from './fechamentoXlsx';

// `dia` é o primeiro dia; `ate` (opcional, até 31 dias depois) fecha o intervalo. Sem `ate`, é um dia só.
// Lança Error('periodo-invalido') se o intervalo for inválido.
export async function carregarFechamento(p: { storeId: string; storeName: string; userName: string; dia: string; ate?: string }): Promise<FechamentoData> {
  const ate = p.ate || p.dia;
  const [ini, fim] = p.ate ? limitesDoPeriodo(p.dia, ate) : limitesDoDia(p.dia);
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
    loja: p.storeName, periodoLabel: rotuloPeriodo(p.dia, ate), geradoEm: new Date(), geradoPor: p.userName,
    turnos, vendas, excecoes: exc.events, nomeCategoria: (id) => nomes.get(id),
  };
}
