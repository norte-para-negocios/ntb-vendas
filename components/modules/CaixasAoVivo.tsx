'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Radio } from 'lucide-react';
import { fetchOpenCashShifts, fetchCashShiftsHistory, fetchCashShiftSummary, subscribeToStoreOrderChanges, CashShiftHistoryRow, CashShiftSummary } from '@/lib/api';
import { formatBRL } from '@/lib/calc';
import { getPaymentMethodLabel } from '@/lib/labels';
import { agruparOperadores, tempoAberto, CaixaAberto } from '@/lib/caixasAoVivo';
import { ProductThumb } from '@/components/ProductThumb';

const INTERVALO_MS = 15000;

const Resumo: React.FC<{ resumo: CashShiftSummary }> = ({ resumo }) => {
  const formas = Object.entries(resumo.totals_by_method || {});
  return (
    <div className="space-y-3">
      <div>
        <h5 className="text-[13px] font-semibold text-[var(--text-muted)] mb-1.5">Total por forma de pagamento</h5>
        {formas.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nenhum pagamento registrado neste turno.</p>
        ) : (
          <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden bg-[var(--surface)]">
            {formas.map(([metodo, total]) => (
              <div key={metodo} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-[var(--text)]">{getPaymentMethodLabel(metodo)}</span>
                <span className="num font-bold text-[var(--text)]">R$ {formatBRL(total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden bg-[var(--surface)]">
        <div className="flex items-center justify-between px-3 py-2 text-sm"><span className="text-[var(--text-muted)]">Fundo de troco</span><span className="num font-semibold">R$ {formatBRL(resumo.shift.opening_float)}</span></div>
        <div className="flex items-center justify-between px-3 py-2 text-sm"><span className="text-[var(--text-muted)]">Sangrias</span><span className="num font-semibold">− R$ {formatBRL(resumo.total_sangria)}</span></div>
        <div className="flex items-center justify-between px-3 py-2 text-sm"><span className="text-[var(--text-muted)]">Suprimentos</span><span className="num font-semibold">+ R$ {formatBRL(resumo.total_suprimento)}</span></div>
        <div className="flex items-center justify-between px-3 py-2.5 text-[15px]"><span className="font-semibold">Dinheiro esperado</span><span className="num font-bold">R$ {formatBRL(resumo.expected_cash)}</span></div>
        {resumo.closing_counted_cash !== null && (
          <>
            <div className="flex items-center justify-between px-3 py-2 text-sm"><span className="text-[var(--text-muted)]">Dinheiro contado</span><span className="num font-semibold">R$ {formatBRL(resumo.closing_counted_cash)}</span></div>
            <div className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-[var(--text-muted)]">Diferença</span>
              <span className={`num font-bold ${(resumo.difference ?? 0) === 0 ? 'text-[var(--ok)]' : 'text-[var(--err)]'}`}>R$ {formatBRL(resumo.difference ?? 0)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const CaixasAoVivo: React.FC<{ storeId: string }> = ({ storeId }) => {
  const [abertos, setAbertos] = useState<CaixaAberto[]>([]);
  const [historico, setHistorico] = useState<CashShiftHistoryRow[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<number | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [resumoAberto, setResumoAberto] = useState<CashShiftSummary | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [resumosHist, setResumosHist] = useState<Record<string, CashShiftSummary | null | 'carregando'>>({});
  const [agora, setAgora] = useState(() => Date.now());
  const ativoRef = useRef(true);
  const historicoRef = useRef<CashShiftHistoryRow[]>([]);

  const carregar = useCallback(async () => {
    const [ab, hi] = await Promise.all([fetchOpenCashShifts(storeId), fetchCashShiftsHistory(storeId, 100)]);
    if (!ativoRef.current) return;
    // As duas funções devolvem lista vazia quando a rede falha. Histórico vazio
    // logo depois de ter tido dados = falha: mantém o que já estava na tela.
    if (hi.length === 0 && historicoRef.current.length > 0) return;
    historicoRef.current = hi;
    setAbertos(ab);
    setHistorico(hi);
    setCarregado(true);
    setAtualizadoEm(Date.now());
  }, [storeId]);

  useEffect(() => {
    ativoRef.current = true;
    carregar();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const desinscrever = subscribeToStoreOrderChanges(storeId, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(carregar, 1000);
    }, undefined, 'caixas_ao_vivo');
    const intervalo = setInterval(carregar, INTERVALO_MS);
    const relogio = setInterval(() => setAgora(Date.now()), 30000);
    return () => {
      ativoRef.current = false;
      if (debounce) clearTimeout(debounce);
      clearInterval(intervalo);
      clearInterval(relogio);
      desinscrever();
    };
  }, [storeId, carregar]);

  const operadores = useMemo(() => agruparOperadores(abertos, historico), [abertos, historico]);
  const operador = operadores.find((o) => o.nome === selecionado) ?? operadores[0] ?? null;
  const idAberto = operador?.aberto?.id ?? null;

  // Resumo do turno aberto do operador escolhido: refeito a cada atualização.
  useEffect(() => {
    if (!idAberto) { setResumoAberto(null); return; }
    let vivo = true;
    fetchCashShiftSummary(idAberto).then((r) => { if (vivo && ativoRef.current && r) setResumoAberto(r); });
    return () => { vivo = false; };
  }, [idAberto, atualizadoEm]);

  const alternarLinha = async (h: CashShiftHistoryRow) => {
    if (expandido === h.id) { setExpandido(null); return; }
    setExpandido(h.id);
    if (h.status === 'closed' && resumosHist[h.id] && resumosHist[h.id] !== 'carregando') return;
    setResumosHist((prev) => ({ ...prev, [h.id]: 'carregando' }));
    const r = await fetchCashShiftSummary(h.id);
    if (ativoRef.current) setResumosHist((prev) => ({ ...prev, [h.id]: r }));
  };

  if (!carregado) return <div className="p-8 text-center text-[var(--text-muted)]">Carregando caixas…</div>;
  if (operadores.length === 0) return <div className="p-8 text-center text-[var(--text-muted)]">Nenhum caixa registrado ainda.</div>;

  const tempo = operador?.aberto ? tempoAberto(operador.aberto.opened_at, agora) : null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" role="tablist" aria-label="Operadores">
        {operadores.map((o) => (
          <button
            key={o.nome}
            type="button"
            role="tab"
            aria-selected={operador?.nome === o.nome}
            onClick={() => { setSelecionado(o.nome); setExpandido(null); }}
            className={`shrink-0 h-9 max-sm:h-11 pl-2.5 pr-3.5 rounded-full text-[14px] font-medium flex items-center gap-2 u-motion u-press-sm ${operador?.nome === o.nome ? 'bg-[var(--brand-soft)] text-[var(--brand)] font-semibold' : 'bg-[var(--surface-2)] text-[var(--text)]'}`}
          >
            <span className={`w-2 h-2 rounded-full ${o.aberto ? 'bg-[var(--ok)]' : 'bg-[var(--text-muted)]/40'}`} aria-hidden />
            {o.nome}
            <span className="sr-only">{o.aberto ? ' (caixa aberto)' : ' (sem caixa aberto)'}</span>
          </button>
        ))}
      </div>

      {operador && (
        <section className="rounded-[var(--r-lg)] bg-[var(--surface-2)] p-4 space-y-3">
          <div className="flex items-center gap-3">
            <ProductThumb name={operador.nome} size="cart" className="!w-11 !h-11 !rounded-full shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[16px] text-[var(--text)] truncate">Caixa de {operador.nome}</p>
              {operador.aberto && tempo ? (
                <p className={`text-[13px] flex items-center gap-1 ${tempo.esquecido ? 'text-[var(--warn)] font-medium' : 'text-[var(--text-muted)]'}`}>
                  {tempo.esquecido && <AlertTriangle size={13} />}
                  Aberto há {tempo.texto}{tempo.esquecido ? ' — esqueceu de fechar?' : ''}
                </p>
              ) : (
                <p className="text-[13px] text-[var(--text-muted)]">Sem caixa aberto agora.</p>
              )}
            </div>
            {operador.aberto && <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-[var(--ok)]/10 text-[var(--ok)] shrink-0">Aberto</span>}
          </div>
          {operador.aberto && (resumoAberto && resumoAberto.shift.id === operador.aberto.id ? <Resumo resumo={resumoAberto} /> : <p className="text-sm text-[var(--text-muted)]">Carregando o turno…</p>)}
        </section>
      )}

      {operador && (
        <section>
          <h4 className="text-[13px] font-semibold text-[var(--text-muted)] mb-2">Histórico de {operador.nome}</h4>
          {operador.historico.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-3">Nenhum turno encontrado.</p>
          ) : (
            <div className="space-y-1.5">
              {operador.historico.map((h) => {
                const aberto = expandido === h.id;
                const r = resumosHist[h.id];
                return (
                  <div key={h.id} className="rounded-xl bg-[var(--surface-2)] overflow-hidden">
                    <button type="button" onClick={() => alternarLinha(h)} aria-expanded={aberto} className="w-full flex items-center justify-between gap-2 p-3 max-sm:min-h-[52px] text-left text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold text-[var(--text)]">{new Date(h.opened_at).toLocaleDateString('pt-BR')} · {new Date(h.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                        <p className="text-xs text-[var(--text-muted)]">{h.status === 'open' ? 'Em aberto' : `Diferença: R$ ${formatBRL(h.difference ?? 0)}`}</p>
                      </div>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${h.status === 'open' ? 'bg-[var(--ok)]/10 text-[var(--ok)]' : 'bg-[var(--surface)] text-[var(--text-muted)]'}`}>{h.status === 'open' ? 'Aberto' : 'Fechado'}</span>
                        <ChevronDown size={16} className={`text-[var(--text-muted)] transition-transform ${aberto ? 'rotate-180' : ''}`} />
                      </span>
                    </button>
                    {aberto && (
                      <div className="px-3 pb-3">
                        {r === 'carregando' || r === undefined ? <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
                          : r === null ? <p className="text-sm text-[var(--text-muted)]">Não foi possível carregar o resumo deste turno.</p>
                          : <Resumo resumo={r} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <p className="text-[12px] text-[var(--text-muted)] flex items-center gap-1.5">
        <Radio size={12} className="text-[var(--ok)]" aria-hidden />
        Ao vivo · atualizado às {atualizadoEm ? new Date(atualizadoEm).toLocaleTimeString('pt-BR') : '—'}
      </p>
    </div>
  );
};
