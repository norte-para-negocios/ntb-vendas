// Janela com a lista de contas de uma linha clicada no painel de Relatórios (25/10/2026), com PDF da lista.
'use client';
import React, { useMemo, useState } from 'react';
import { ChevronDown, Printer, Search } from 'lucide-react';
import { Button, Input, Modal } from '@/components/ui';
import { toast } from '@/components/Toast';
import { formatBRL } from '@/lib/calc';
import { printListaDeContas } from '@/lib/print';
import type { ContaResumo } from '@/lib/reports/analiseVendas';
import type { RelatorioMeta } from '@/lib/reports/relatorioHtml';

const quandoBr = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export const ListaDeContas: React.FC<{ contas: ContaResumo[]; limite?: number; busca?: boolean }> = ({ contas, limite = 50, busca = true }) => {
  const [termo, setTermo] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(limite);
  const filtradas = useMemo(() => {
    const t = termo.trim().toLowerCase();
    if (!t) return contas;
    return contas.filter((c) => `${c.local} ${c.operador} ${c.formas} ${c.itens.map((i) => i.nome).join(' ')}`.toLowerCase().includes(t));
  }, [contas, termo]);
  if (contas.length === 0) return <p className="text-[14px] text-[var(--text-muted)] py-4 text-center">Nada neste período.</p>;
  return (
    <div className="space-y-2">
      {busca && (
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-[var(--text-muted)] pointer-events-none" />
          <Input aria-label="Buscar conta" placeholder="Buscar por mesa, produto, forma ou pessoa" value={termo} onChange={(e) => setTermo(e.target.value)} className="!pl-9" />
        </div>
      )}
      <div className="rounded-[14px] border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
        {filtradas.slice(0, mostrar).map((c) => (
          <div key={c.id}>
            <button type="button" onClick={() => setAberta(aberta === c.id ? null : c.id)} aria-expanded={aberta === c.id}
              className="w-full min-h-12 flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--surface-2)] u-motion">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-[var(--text)] truncate">{c.local} <span className="font-normal text-[var(--text-muted)] num">· {quandoBr(c.quando)}</span></p>
                <p className="text-[12px] text-[var(--text-muted)] truncate">{c.formas} · recebeu {c.operador} · {(() => { const n = c.itens.reduce((s, i) => s + i.qtd, 0); return `${n} ${n === 1 ? 'item' : 'itens'}`; })()}</p>
              </div>
              <span className="num font-semibold text-[var(--text)] shrink-0">R$ {formatBRL(c.total)}</span>
              <ChevronDown size={16} className={`text-[var(--text-muted)] shrink-0 transition-transform ${aberta === c.id ? 'rotate-180' : ''}`} />
            </button>
            {aberta === c.id && (
              <ul className="px-4 pb-3 pt-1 space-y-1 bg-[var(--surface-2)]/50">
                {c.itens.map((i, n) => (
                  <li key={n} className="flex justify-between gap-3 text-[13px]"><span className="text-[var(--text)]">{i.qtd}× {i.nome}</span><span className="num text-[var(--text-muted)]">R$ {formatBRL(i.total)}</span></li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {filtradas.length > mostrar && (
        <Button variant="secondary" className="w-full" onClick={() => setMostrar((m) => m + 100)}>Mostrar mais ({filtradas.length - mostrar} restantes)</Button>
      )}
    </div>
  );
};

export const ListaDetalhe: React.FC<{ titulo: string | null; contas: ContaResumo[]; meta: RelatorioMeta; onClose: () => void }> = ({ titulo, contas, meta, onClose }) => {
  const total = contas.reduce((s, c) => s + c.total, 0);
  const imprimir = async () => {
    if (!titulo) return;
    const ok = await printListaDeContas(titulo, contas, meta).catch(() => false);
    if (!ok) toast.error('Não consegui abrir a impressão. Confira o bloqueador de janelas.');
  };
  return (
    <Modal isOpen={!!titulo} onClose={onClose} title={titulo ?? ''} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] text-[var(--text-muted)]"><b className="num text-[var(--text)]">{contas.length}</b> contas · <b className="num text-[var(--text)]">R$ {formatBRL(total)}</b> · {meta.periodoLabel}</p>
          <Button variant="secondary" size="sm" onClick={imprimir} disabled={contas.length === 0}><Printer size={15} /> PDF desta lista</Button>
        </div>
        <ListaDeContas contas={contas} />
      </div>
    </Modal>
  );
};
