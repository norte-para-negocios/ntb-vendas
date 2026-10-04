// components/modules/ReportsView.tsx
'use client';
import React, { useState } from 'react';
import { Download, FileSpreadsheet, BarChart3, ListChecks } from 'lucide-react';
import { Button, Card, Input } from '@/components/ui';
import { toast } from '@/components/Toast';
import { fetchCashShiftsHistory, fetchCashShiftSummary, fetchSalesHistory, fetchExceptionsReport, fetchMenu, type CashShiftSummary, type CashShiftHistoryRow } from '@/lib/api';
import { groupSales, type GroupBy, type GroupRow } from '@/lib/reports/groupSales';
import { salesOfShift } from '@/lib/reports/shiftSales';
import { completarFormas, completarCartoes, ticketMedio } from '@/lib/caixaResumo';
import { formatBRL } from '@/lib/calc';
import type { Order } from '@/types';
import { buildFechamentoWorkbook, fechamentoFileName, type FechamentoTurno } from '@/lib/reports/fechamentoXlsx';

const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bahia' });

// Início e fim do dia em Bahia (UTC-3, sem horário de verão) como instantes UTC.
const limitesDoDia = (dia: string): [Date, Date] => [new Date(`${dia}T00:00:00-03:00`), new Date(`${dia}T23:59:59.999-03:00`)];

export const ReportsView: React.FC<{ storeId: string; storeName: string; storeSlug: string; userName: string }> = ({ storeId, storeName, storeSlug, userName }) => {
  const [dia, setDia] = useState(hojeISO());
  const [gerando, setGerando] = useState(false);

  // --- Análise de vendas agrupada ---
  const [agrupar, setAgrupar] = useState<GroupBy>('hour');
  const [linhas, setLinhas] = useState<GroupRow[] | null>(null);
  const [carregandoAnalise, setCarregandoAnalise] = useState(false);
  const verAnalise = async () => {
    setCarregandoAnalise(true);
    try {
      const [ini, fim] = limitesDoDia(dia);
      const [vendas, menu] = await Promise.all([fetchSalesHistory(storeId, ini.toISOString(), fim.toISOString()), agrupar === 'category' ? fetchMenu(storeId, false, true) : Promise.resolve(null)]);
      const rows = groupSales(vendas, agrupar);
      setLinhas(menu ? rows.map((r) => ({ ...r, label: r.key === '_sem' ? r.label : menu.categories.find((c) => c.id === r.key)?.name ?? r.label })) : rows);
    } catch (e) {
      console.error('verAnalise falhou:', e);
      toast.error('Não consegui carregar a análise.');
    } finally {
      setCarregandoAnalise(false);
    }
  };

  // --- Conferir um turno (drill-down) ---
  const [turnos, setTurnos] = useState<CashShiftHistoryRow[] | null>(null);
  const [vendasDia, setVendasDia] = useState<Order[]>([]);
  const [turnoAberto, setTurnoAberto] = useState<{ id: string; resumo: CashShiftSummary } | null>(null);
  const [formaAberta, setFormaAberta] = useState<string | null>(null);
  const [carregandoTurnos, setCarregandoTurnos] = useState(false);
  const carregarTurnos = async () => {
    setCarregandoTurnos(true);
    setTurnoAberto(null);
    setFormaAberta(null);
    try {
      const [ini, fim] = limitesDoDia(dia);
      const [rows, vendas] = await Promise.all([fetchCashShiftsHistory(storeId, 200), fetchSalesHistory(storeId, ini.toISOString(), fim.toISOString())]);
      setTurnos(rows.filter((t) => new Date(t.opened_at) >= ini && new Date(t.opened_at) <= fim));
      setVendasDia(vendas);
    } catch (e) {
      console.error('carregarTurnos falhou:', e);
      toast.error('Não consegui carregar os turnos.');
    } finally {
      setCarregandoTurnos(false);
    }
  };
  const abrirTurno = async (id: string) => {
    setFormaAberta(null);
    const resumo = await fetchCashShiftSummary(id);
    if (resumo) setTurnoAberto({ id, resumo }); else toast.error('Não consegui abrir o turno.');
  };
  const horaLocal = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' });

  const baixarFechamento = async () => {
    setGerando(true);
    try {
      const [ini, fim] = limitesDoDia(dia);
      const [turnosRows, vendas, exc] = await Promise.all([
        fetchCashShiftsHistory(storeId, 200),
        fetchSalesHistory(storeId, ini.toISOString(), fim.toISOString()),
        fetchExceptionsReport(storeId, ini, fim),
      ]);
      const doDia = turnosRows.filter((t) => new Date(t.opened_at) >= ini && new Date(t.opened_at) <= fim);
      const turnos: FechamentoTurno[] = [];
      for (const t of doDia) {
        // eslint-disable-next-line no-await-in-loop -- poucos turnos por dia
        const resumo = await fetchCashShiftSummary(t.id);
        if (resumo) turnos.push({ operador: t.operator_name ?? 'Equipe', abertoEm: t.opened_at, fechadoEm: t.closed_at, fundo: Number(t.opening_float), contado: t.closing_counted_cash, resumo });
      }
      const wb = await buildFechamentoWorkbook({
        loja: storeName, periodoLabel: new Date(`${dia}T12:00:00-03:00`).toLocaleDateString('pt-BR'), geradoEm: new Date(), geradoPor: userName,
        turnos, vendas, excecoes: exc.events,
      });
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fechamentoFileName(storeSlug, dia);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(turnos.length === 0 ? 'Arquivo gerado (nenhum turno de caixa nesse dia).' : 'Arquivo gerado.');
    } catch (e) {
      console.error('baixarFechamento falhou:', e);
      toast.error('Não consegui gerar o arquivo. Tente de novo.');
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[17px] font-semibold text-[var(--text)]">Relatórios</h3>
        <p className="text-[13px] text-[var(--text-muted)]">Arquivos prontos para o contador conciliar. O Excel traz as abas Resumo, Formas de pagamento, Cartões, Caixa, Vendas, Itens e Exceções.</p>
      </div>
      <Card className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <FileSpreadsheet size={22} className="text-[var(--brand)] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-[15px] font-semibold text-[var(--text)]">Fechamento do dia (Excel)</h4>
            <p className="text-[13px] text-[var(--text-muted)]">Todos os turnos de caixa do dia, com meios de pagamento e bandeiras (inclusive zeradas), ticket médio, vendas, itens e exceções.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[13px] text-[var(--text-muted)]">Dia
            <Input type="date" value={dia} max={hojeISO()} onChange={(e) => setDia(e.target.value)} />
          </label>
          <Button onClick={baixarFechamento} isLoading={gerando} disabled={!dia}><Download size={16} /> Baixar Excel</Button>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <BarChart3 size={22} className="text-[var(--brand)] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-[15px] font-semibold text-[var(--text)]">Análise de vendas do dia</h4>
            <p className="text-[13px] text-[var(--text-muted)]">Veja onde o movimento se concentra: por hora, operador, forma de pagamento ou categoria. Uma conta com vários pedidos conta como uma venda só.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[13px] text-[var(--text-muted)]">Agrupar por
            <select className="block h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]" value={agrupar} onChange={(e) => { setAgrupar(e.target.value as GroupBy); setLinhas(null); }}>
              <option value="hour">Hora</option>
              <option value="operator">Operador</option>
              <option value="method">Forma de pagamento</option>
              <option value="category">Categoria (itens vendidos)</option>
            </select>
          </label>
          <Button onClick={verAnalise} isLoading={carregandoAnalise} disabled={!dia}>Ver análise</Button>
        </div>
        {linhas && (linhas.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nenhuma venda nesse dia.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead><tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="px-3 py-2 font-semibold">{agrupar === 'hour' ? 'Hora' : agrupar === 'operator' ? 'Operador' : agrupar === 'method' ? 'Forma' : 'Categoria'}</th>
                <th className="px-3 py-2 font-semibold text-right">Total</th>
                {agrupar !== 'category' && <th className="px-3 py-2 font-semibold text-right">Vendas</th>}
                {agrupar !== 'category' && <th className="px-3 py-2 font-semibold text-right">Ticket médio</th>}
              </tr></thead>
              <tbody className="divide-y divide-[var(--border)]">
                {linhas.map((r) => (
                  <tr key={r.key}>
                    <td className="px-3 py-2 text-[var(--text)]">{r.label}</td>
                    <td className="px-3 py-2 text-right num font-semibold text-[var(--text)]">R$ {formatBRL(r.total)}</td>
                    {agrupar !== 'category' && <td className="px-3 py-2 text-right num text-[var(--text)]">{r.orders}</td>}
                    {agrupar !== 'category' && <td className="px-3 py-2 text-right num text-[var(--text)]">R$ {formatBRL(r.ticket)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <ListChecks size={22} className="text-[var(--brand)] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-[15px] font-semibold text-[var(--text)]">Conferir um turno</h4>
            <p className="text-[13px] text-[var(--text-muted)]">Abra um turno do dia, veja cada forma de pagamento e toque nela para listar as vendas que formam o valor.</p>
          </div>
        </div>
        <Button variant="secondary" onClick={carregarTurnos} isLoading={carregandoTurnos} disabled={!dia}>Carregar turnos do dia</Button>
        {turnos && (turnos.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nenhum turno de caixa nesse dia.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {turnos.map((t) => (
              <button key={t.id} type="button" onClick={() => abrirTurno(t.id)}
                className={`min-h-11 px-4 rounded-xl border text-left text-[14px] u-press ${turnoAberto?.id === t.id ? 'border-[var(--brand)] bg-[var(--surface-2)]' : 'border-[var(--border)]'}`}>
                <span className="font-semibold text-[var(--text)]">{t.operator_name ?? 'Equipe'}</span>
                <span className="block text-[12px] text-[var(--text-muted)] num">{horaLocal(t.opened_at)}–{t.closed_at ? horaLocal(t.closed_at) : 'aberto'}</span>
              </button>
            ))}
          </div>
        ))}
        {turnoAberto && (
          <div className="space-y-3">
            <p className="text-[14px] text-[var(--text)]">
              {turnoAberto.resumo.payments_count != null ? <>Contas pagas: <b className="num">{turnoAberto.resumo.payments_count}</b> · Total: <b className="num">R$ {formatBRL(Number(turnoAberto.resumo.payments_total) || 0)}</b> · Ticket médio: <b className="num">{ticketMedio(turnoAberto.resumo.payments_total, turnoAberto.resumo.payments_count) != null ? `R$ ${formatBRL(ticketMedio(turnoAberto.resumo.payments_total, turnoAberto.resumo.payments_count) as number)}` : '—'}</b></> : 'Resumo do turno'}
            </p>
            <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
              {completarFormas(turnoAberto.resumo.totals_by_method).map((f) => (
                <button key={f.key} type="button" onClick={() => setFormaAberta(formaAberta === f.key ? null : f.key)}
                  className={`w-full min-h-11 flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-[var(--surface-2)] ${formaAberta === f.key ? 'bg-[var(--surface-2)]' : ''}`}>
                  <span className="text-[var(--text)]">{f.label}</span>
                  <span className="num font-bold text-[var(--text)]">R$ {formatBRL(f.total)}</span>
                </button>
              ))}
            </div>
            {(turnoAberto.resumo.totals_by_card && Object.keys(turnoAberto.resumo.totals_by_card).length > 0) && (
              <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                {completarCartoes(turnoAberto.resumo.totals_by_card).map((c) => (
                  <div key={c.label} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-[var(--text)]">{c.label}</span>
                    <span className="num font-bold text-[var(--text)]">R$ {formatBRL(c.total)}</span>
                  </div>
                ))}
              </div>
            )}
            {formaAberta && (() => {
              const lista = salesOfShift(vendasDia, turnoAberto.id, formaAberta);
              return (
                <div>
                  <h5 className="eyebrow mb-2">Vendas em {completarFormas(turnoAberto.resumo.totals_by_method).find((f) => f.key === formaAberta)?.label ?? formaAberta} ({lista.length})</h5>
                  {lista.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Nenhuma venda dessa forma neste turno.</p> : (
                    <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                      {lista.map((o) => {
                        const pd = o.payment_details as { operador_nome?: string; methods?: { method: string; amount: number }[] } | null;
                        const valor = (pd?.methods ?? []).filter((m) => m.method === formaAberta).reduce((x, m) => x + Number(m.amount), 0);
                        return (
                          <div key={o.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                            <span className="text-[var(--text)]">{o.order_type === 'counter' ? 'Balcão' : `Mesa ${(o as { tables?: { number?: number } }).tables?.number ?? ''}`} <span className="text-[var(--text-muted)] num">· {horaLocal(o.created_at)}{pd?.operador_nome ? ` · ${pd.operador_nome}` : ''}</span></span>
                            <span className="num font-semibold text-[var(--text)]">R$ {formatBRL(valor)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </Card>
    </div>
  );
};
