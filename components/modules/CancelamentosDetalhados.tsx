'use client';

// Lista detalhada de cada cancelamento (04/11/2026, migration 193): hora do pedido e do cancelamento, mesa/balcão, setor,
// motivo, quem lançou, quem pediu o cancelamento e quem autorizou. Regras em lib/cancelamentosDetalhados.ts.
import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { formatBRL } from '@/lib/calc';
import {
  type Cancelamento, type FiltroCancelamentos, filtrarCancelamentos, linhasCsvCancelamentos, localDoCancelamento,
  minutosAteCancelar, quemAutorizou, resumoCancelamentos, statusAnteriorLabel,
} from '@/lib/cancelamentosDetalhados';

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const depois = (min: number | null) => (min == null ? '' : min < 60 ? ` (${min} min depois)` : ` (${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')} depois)`);

const baixarCsv = (lista: Cancelamento[]) => {
  const linhas = linhasCsvCancelamentos(lista).map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'));
  const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cancelamentos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const sel = 'h-9 max-sm:h-11 px-3 rounded-lg bg-[var(--surface-2)] text-[var(--text)] text-[14px] max-sm:text-base';

export const CancelamentosDetalhados: React.FC<{ lista: Cancelamento[] }> = ({ lista }) => {
  const [f, setF] = useState<FiltroCancelamentos>({ local: 'todos' });
  const filtrados = useMemo(() => filtrarCancelamentos(lista, f), [lista, f]);
  const resumo = useMemo(() => resumoCancelamentos(filtrados), [filtrados]);
  const pessoas = useMemo(() => [...new Set(lista.flatMap((c) => [c.autorizado_por, c.cancelado_por, c.lancado_por]).filter((x): x is string => !!x))].sort(), [lista]);
  const motivos = useMemo(() => [...new Set(lista.map((c) => c.motivo ?? 'Sem motivo'))].sort(), [lista]);
  const setores = useMemo(() => [...new Set(lista.map((c) => c.setor ?? 'Sem setor'))].sort(), [lista]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h4 className="text-[13px] font-semibold text-[var(--text-muted)]">Cada cancelamento</h4>
          <p className="text-[12px] text-[var(--text-muted)]">Hora do pedido e do cancelamento, onde estava, quem pediu e quem autorizou.</p>
        </div>
        <button type="button" onClick={() => baixarCsv(filtrados)} disabled={filtrados.length === 0}
          className="inline-flex items-center gap-1.5 h-9 max-sm:h-11 px-3 rounded-lg bg-[var(--surface-2)] text-[var(--text)] text-[13px] font-medium disabled:opacity-50">
          <Download size={15} /> Baixar planilha
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <select aria-label="Local" className={sel} value={f.local ?? 'todos'} onChange={(e) => setF({ ...f, local: e.target.value as FiltroCancelamentos['local'] })}>
          <option value="todos">Mesas e balcão</option>
          <option value="mesa">Só mesas</option>
          <option value="balcao">Só balcão</option>
        </select>
        <select aria-label="Pessoa" className={sel} value={f.pessoa ?? ''} onChange={(e) => setF({ ...f, pessoa: e.target.value || undefined })}>
          <option value="">Todas as pessoas</option>
          {pessoas.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select aria-label="Motivo" className={sel} value={f.motivo ?? ''} onChange={(e) => setF({ ...f, motivo: e.target.value || undefined })}>
          <option value="">Todos os motivos</option>
          {motivos.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label="Setor" className={sel} value={f.setor ?? ''} onChange={(e) => setF({ ...f, setor: e.target.value || undefined })}>
          <option value="">Todos os setores</option>
          {setores.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input aria-label="Buscar" placeholder="Buscar produto ou mesa" className={`${sel} min-w-[180px] flex-1`} value={f.busca ?? ''}
          onChange={(e) => setF({ ...f, busca: e.target.value || undefined })} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><p className="text-[12px] text-[var(--text-muted)]">Cancelamentos</p><p className="num text-[20px] font-semibold">{resumo.quantidade}</p></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><p className="text-[12px] text-[var(--text-muted)]">Valor cancelado</p><p className="num text-[20px] font-semibold">R$ {formatBRL(resumo.valor)}</p></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><p className="text-[12px] text-[var(--text-muted)]">Quem mais autorizou</p><p className="text-[15px] font-semibold truncate">{resumo.porPessoa[0] ? `${resumo.porPessoa[0].nome} (${resumo.porPessoa[0].quantidade})` : '—'}</p></div>
        <div className="rounded-xl bg-[var(--surface-2)] p-3"><p className="text-[12px] text-[var(--text-muted)]">Motivo mais comum</p><p className="text-[15px] font-semibold truncate">{resumo.porMotivo[0] ? `${resumo.porMotivo[0].nome} (${resumo.porMotivo[0].quantidade})` : '—'}</p></div>
      </div>

      {filtrados.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-3">Nenhum cancelamento neste período.</p>
      ) : (
        <div className="rounded-xl bg-[var(--surface-2)] divide-y divide-[var(--border)] overflow-hidden">
          {filtrados.map((c) => (
            <div key={c.id} className="px-3 py-2.5 text-sm space-y-0.5">
              <div className="flex justify-between gap-2">
                <p className="font-semibold text-[var(--text)] min-w-0">{c.quantidade}× {c.produto}{c.parcial ? ' (parte do item)' : ''}</p>
                <span className="num shrink-0 font-semibold line-through decoration-[var(--text-muted)]/50">R$ {formatBRL(Number(c.valor) || 0)}</span>
              </div>
              <p className="text-[13px] text-[var(--text)]">
                <span className="font-medium">{localDoCancelamento(c)}</span>{c.setor ? ` · ${c.setor}` : ''} · {statusAnteriorLabel(c.status_anterior)}
              </p>
              <p className="text-[13px] text-[var(--text-muted)] num">
                {c.pedido_em ? `Pedido ${dia(c.pedido_em)} ${hora(c.pedido_em)} → ` : ''}Cancelado {dia(c.cancelado_em)} {hora(c.cancelado_em)}{depois(minutosAteCancelar(c))}
              </p>
              <p className="text-[13px] text-[var(--warn)] font-medium">{c.motivo ? `“${c.motivo}”` : 'Sem motivo registrado'}</p>
              <p className="text-[12px] text-[var(--text-muted)]">
                {c.lancado_por ? `Lançado por ${c.lancado_por} · ` : ''}Pediu o cancelamento: {c.cancelado_por ?? '—'} · Autorizou: {quemAutorizou(c)}
              </p>
            </div>
          ))}
        </div>
      )}
      {lista.some((c) => !c.pedido_em) && (
        <p className="text-[12px] text-[var(--text-muted)]">Cancelamentos feitos antes de 05/11/2026 não guardaram a mesa nem a hora do pedido.</p>
      )}
    </section>
  );
};
