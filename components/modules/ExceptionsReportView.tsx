'use client';
// Relatório de exceções por operador (2026-10-04, migration 150): cancelamentos, taxa editada/removida,
// estornos, sangrias grandes, diferença de caixa e notas canceladas — por operador e período.
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui';
import { fetchExceptionsReport } from '@/lib/api';
import { formatBRL } from '@/lib/calc';
import {
  DEFAULT_EXCEPTION_THRESHOLD, EXCEPTION_LABELS, ExceptionsReport,
  operatorTotalExceptions, operatorsOverThreshold,
} from '@/lib/excecoes';

type Periodo = 'hoje' | '7d' | '30d';

const intervalo = (p: Periodo): [Date, Date] => {
  const fim = new Date(Date.now() + 60_000);
  const ini = new Date();
  ini.setHours(0, 0, 0, 0);
  if (p === '7d') ini.setDate(ini.getDate() - 6);
  if (p === '30d') ini.setDate(ini.getDate() - 29);
  return [ini, fim];
};

// Status do item como o operador entende (o banco guarda em inglês).
const STATUS_ANTERIOR: Record<string, string> = { pending: 'aguardando', accepted: 'aceito', preparing: 'em preparo', ready: 'pronto', delivered: 'entregue' };

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export const ExceptionsReportView: React.FC<{ storeId: string; threshold?: number }> = ({ storeId, threshold = DEFAULT_EXCEPTION_THRESHOLD }) => {
  const [periodo, setPeriodo] = useState<Periodo>('hoje');
  const [report, setReport] = useState<ExceptionsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtroOperador, setFiltroOperador] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [de, ate] = intervalo(periodo);
    setReport(await fetchExceptionsReport(storeId, de, ate));
    setLoading(false);
  }, [storeId, periodo]);
  useEffect(() => { carregar(); }, [carregar]);

  const rows = report?.by_operator ?? [];
  const acima = operatorsOverThreshold(rows, threshold);
  const eventos = (report?.events ?? []).filter((e) => !filtroOperador || e.operator_name === filtroOperador);
  const tipos = Array.from(new Set(rows.flatMap((r) => Object.keys(r.counts))));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-semibold text-[var(--text)]">Exceções por operador</h3>
          <p className="text-[13px] text-[var(--text-muted)]">Cancelamentos, taxa editada ou removida, estornos, sangrias grandes e notas canceladas.</p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-full bg-[var(--surface-2)]" role="tablist" aria-label="Período">
          {([['hoje', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias']] as [Periodo, string][]).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={periodo === id}
              onClick={() => setPeriodo(id)}
              className={`h-8 max-sm:h-11 px-4 rounded-full text-[13px] font-semibold u-press ${periodo === id ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)]'}`}
            >{label}</button>
          ))}
        </div>
      </div>

      {acima.length > 0 && (
        <Card className="p-4 border-[var(--warn)]/40">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-[var(--warn)] shrink-0 mt-0.5" />
            <p className="text-[15px] text-[var(--text)]">
              <span className="font-semibold">Acima do limite ({threshold} ocorrências no período):</span>{' '}
              {acima.map((r) => `${r.operator_name} (${operatorTotalExceptions(r)})`).join(', ')}
            </p>
          </div>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
      ) : rows.length === 0 && !(report?.notas_canceladas.count) ? (
        <Card className="p-6 flex items-center gap-3 text-[var(--text-muted)]"><ShieldCheck size={18} /> Nenhuma exceção no período.</Card>
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="px-4 py-3 font-semibold">Operador</th>
                  {tipos.map((t) => <th key={t} className="px-3 py-3 font-semibold whitespace-nowrap">{EXCEPTION_LABELS[t] ?? t}</th>)}
                  <th className="px-3 py-3 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((r) => {
                  const over = r.operator_name && acima.some((a) => a.operator_name === r.operator_name);
                  return (
                    <tr key={r.operator_name} onClick={() => setFiltroOperador((f) => (f === r.operator_name ? null : r.operator_name))} className={`cursor-pointer ${filtroOperador === r.operator_name ? 'bg-[var(--surface-2)]' : ''}`}>
                      <td className="px-4 py-3 font-medium text-[var(--text)]">{over && <AlertTriangle size={13} className="inline mr-1 text-[var(--warn)]" />}{r.operator_name}</td>
                      {tipos.map((t) => (
                        <td key={t} className="px-3 py-3 num text-[var(--text)]">
                          {r.counts[t] ? <>{r.counts[t]}{Number(r.values[t]) > 0 && <span className="text-[var(--text-muted)]"> · R$ {formatBRL(Number(r.values[t]))}</span>}</> : <span className="text-[var(--text-muted)]">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-3 num font-semibold text-[var(--text)]">{operatorTotalExceptions(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {report && report.notas_canceladas.count > 0 && (
            <p className="text-[14px] text-[var(--text)]">
              Notas fiscais canceladas no período: <span className="font-semibold num">{report.notas_canceladas.count}</span> (R$ <span className="num">{formatBRL(report.notas_canceladas.valor)}</span>).
            </p>
          )}

          <div>
            <h4 className="eyebrow mb-2">Ocorrências{filtroOperador ? ` — ${filtroOperador}` : ''} <span className="text-[var(--text-muted)] normal-case">(toque numa linha acima para filtrar)</span></h4>
            <Card className="divide-y divide-[var(--border)]">
              {eventos.slice(0, 80).map((e, i) => {
                const d = e.details as Record<string, unknown>;
                const detalhe = [
                  d.produto ? String(d.produto) : null,
                  d.quantidade ? `${d.quantidade}x` : null,
                  d.valor ? `R$ ${formatBRL(Number(d.valor))}` : null,
                  d.status_anterior ? `estava: ${STATUS_ANTERIOR[String(d.status_anterior)] ?? String(d.status_anterior)}` : null,
                  d.de !== undefined && d.para !== undefined ? `de R$ ${formatBRL(Number(d.de))} para R$ ${formatBRL(Number(d.para))}` : null,
                  d.motivo ? `motivo: ${d.motivo}` : null,
                ].filter(Boolean).join(' · ');
                return (
                  <div key={i} className="px-4 py-3 flex items-start justify-between gap-3 text-[14px]">
                    <div className="min-w-0">
                      <p className="text-[var(--text)]"><span className="font-semibold">{e.operator_name}</span> — {EXCEPTION_LABELS[e.event_type] ?? e.event_type}</p>
                      {detalhe && <p className="text-[var(--text-muted)] break-words">{detalhe}</p>}
                    </div>
                    <span className="text-[13px] text-[var(--text-muted)] num whitespace-nowrap">{hora(e.created_at)}</span>
                  </div>
                );
              })}
              {eventos.length === 0 && <p className="px-4 py-4 text-sm text-[var(--text-muted)]">Sem ocorrências.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
