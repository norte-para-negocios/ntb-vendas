// Tudo o que uma pessoa fez no período (Relatórios v2, 26/10/2026): números, gráficos, produtos, recebimentos,
// exceções e a linha do tempo (entrou, lançou, recebeu, cancelou, pré-conta, trocou mesa, ponto). PDF da pessoa.
'use client';
import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, Clock, LogIn, LogOut, Printer, Receipt, ShoppingBag, Store, XCircle, FileText, Fingerprint, Circle } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { EXCEPTION_LABELS } from '@/lib/excecoes';
import type { EventoLinha, Pessoa } from '@/lib/reports/analiseEquipe';
import { duracao } from '@/lib/reports/relatorioEquipeHtml';
import { Barras, Ranking, Rosca, brl } from './graficos';
import { Avatar, papelDe } from './AbaEquipe';

const TIPOS: { valor: EventoLinha['tipo'] | 'todos'; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Tudo' }, { valor: 'lancou', rotulo: 'Lançou' }, { valor: 'recebeu', rotulo: 'Recebeu' }, { valor: 'cancelou', rotulo: 'Cancelou' }, { valor: 'excecao', rotulo: 'Transferências e taxa' },
  { valor: 'login', rotulo: 'Entradas' }, { valor: 'pre_conta', rotulo: 'Pré-contas' }, { valor: 'mesa', rotulo: 'Mesas' }, { valor: 'ponto', rotulo: 'Ponto' },
];
const ICONE: Record<EventoLinha['tipo'], React.ReactNode> = {
  login: <LogIn size={14} />, logout: <LogOut size={14} />, lancou: <ShoppingBag size={14} />, recebeu: <Receipt size={14} />, cancelou: <XCircle size={14} />, excecao: <ArrowLeftRight size={14} />,
  pre_conta: <FileText size={14} />, mesa: <Store size={14} />, ponto: <Fingerprint size={14} />, outro: <Circle size={14} />,
};
const COR: Partial<Record<EventoLinha['tipo'], string>> = { lancou: 'var(--brand)', recebeu: 'var(--ok)', cancelou: 'var(--err)', excecao: 'var(--warn)', login: 'var(--info)', logout: 'var(--text-muted)' };
const horaBr = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' });
const diaBr = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia', weekday: 'long', day: '2-digit', month: '2-digit' });

function Numero({ rotulo, valor, sub, alerta }: { rotulo: string; valor: string; sub?: string; alerta?: boolean }) {
  return (
    <div className="rounded-[14px] bg-[var(--surface-2)] p-3 min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[var(--text-muted)]">{rotulo}</p>
      <p className={`text-[18px] font-bold num truncate ${alerta ? 'text-[var(--err)]' : 'text-[var(--text)]'}`}>{valor}</p>
      {sub && <p className="text-[12px] text-[var(--text-muted)] num truncate">{sub}</p>}
    </div>
  );
}

export const PessoaDetalhe: React.FC<{
  pessoa: Pessoa | null;
  indice: number;
  linha: EventoLinha[];
  periodoLabel: string;
  onClose: () => void;
  verContas: (nome: string) => void;
  pdf: (p: Pessoa, linha: EventoLinha[]) => void;
}> = ({ pessoa: p, indice, linha, periodoLabel, onClose, verContas, pdf }) => {
  const [tipo, setTipo] = useState<EventoLinha['tipo'] | 'todos'>('todos');
  const [mostrar, setMostrar] = useState(50);
  const filtrada = useMemo(() => linha.filter((e) => tipo === 'todos' || e.tipo === tipo || (tipo === 'login' && e.tipo === 'logout')), [linha, tipo]);
  if (!p) return <Modal isOpen={false} onClose={onClose} title=""><span /></Modal>;
  const horas = p.lancou.porHora.map((v, h) => ({ h, v })).filter((x) => x.v > 0);
  const de = horas.length ? horas[0].h : 0; const ate = horas.length ? horas[horas.length - 1].h : -1;
  const porHora = Array.from({ length: Math.max(0, ate - de + 1) }, (_, i) => ({ rotulo: `${String(de + i).padStart(2, '0')}h`, valor: p.lancou.porHora[de + i] }));
  const maxProd = Math.max(1, ...p.lancou.produtos.map((x) => x.total));
  let diaAnterior = '';

  return (
    <Modal isOpen onClose={onClose} title={p.nome} size="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar nome={p.nome} i={indice} grande />
          <div className="flex-1 min-w-0">
            <p className="text-[18px] font-bold text-[var(--text)] truncate">{p.nome}</p>
            <p className="text-[13px] text-[var(--text-muted)]">{papelDe(p.papel)} · {periodoLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => verContas(p.nome)} disabled={p.lancou.contas === 0}><Receipt size={15} /> Contas que lançou</Button>
            <Button size="sm" onClick={() => pdf(p, linha)}><Printer size={15} /> PDF desta pessoa</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Numero rotulo="Lançou" valor={brl(p.lancou.valor)} sub={`${p.lancou.itens} itens`} />
          <Numero rotulo="Recebeu" valor={brl(p.recebeu.valor)} sub={`${p.recebeu.contas} contas`} />
          <Numero rotulo="Tempo logado" valor={duracao(p.login.minutos)} sub={`${p.login.entradas} entradas`} />
          <Numero rotulo="Cancelou" valor={String(p.excecoes.cancelados.qtd)} sub={p.excecoes.cancelados.qtd ? brl(p.excecoes.cancelados.valor) : 'nada'} alerta={p.excecoes.cancelados.qtd > 0} />
          <Numero rotulo="Mesas atendidas" valor={String(p.lancou.mesas)} sub={`${p.lancou.contas} contas com itens dela`} />
          <Numero rotulo="Mesas abertas" valor={String(p.mesasAbertas)} sub={`${p.mesasTrocadas} trocas de mesa`} />
          <Numero rotulo="Pré-contas" valor={String(p.preContas)} />
          <Numero rotulo="Ponto" valor={duracao(p.ponto.minutos)} sub={p.login.primeiro ? `1ª entrada ${horaBr(p.login.primeiro)}` : undefined} />
        </div>

        {porHora.length > 0 && (
          <section>
            <h4 className="text-[15px] font-semibold text-[var(--text)] mb-2 flex items-center gap-2"><Clock size={15} className="text-[var(--text-muted)]" /> Itens lançados por hora</h4>
            <Barras dados={porHora} formatar={(n) => `${n} itens`} altura={180} />
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <section>
            <h4 className="text-[15px] font-semibold text-[var(--text)] mb-2">Produtos que lançou</h4>
            <div className="max-h-[320px] overflow-y-auto pr-1">
              <Ranking dados={p.lancou.produtos.map((x) => ({ chave: x.nome, rotulo: x.nome, valor: `${x.qtd} un.`, extra: brl(x.total), frac: x.total / maxProd }))} />
            </div>
          </section>
          <section className="space-y-5">
            <div>
              <h4 className="text-[15px] font-semibold text-[var(--text)] mb-2">Categorias que lançou</h4>
              <Rosca dados={p.lancou.categorias.map((c) => ({ chave: c.nome, rotulo: c.nome, valor: c.total }))} />
            </div>
            {p.recebeu.porForma.length > 0 && (
              <div>
                <h4 className="text-[15px] font-semibold text-[var(--text)] mb-2">Contas que recebeu, por forma</h4>
                <Rosca dados={p.recebeu.porForma.map((f) => ({ chave: f.chave, rotulo: f.rotulo, valor: f.total }))} />
              </div>
            )}
            {Object.keys(p.excecoes.porTipo).length > 0 && (
              <div>
                <h4 className="text-[15px] font-semibold text-[var(--text)] mb-2">Exceções</h4>
                <ul className="space-y-1">{Object.entries(p.excecoes.porTipo).map(([t, n]) => <li key={t} className="flex justify-between text-[14px]"><span className="text-[var(--text)]">{EXCEPTION_LABELS[t] ?? t}</span><b className="num text-[var(--err)]">{n}</b></li>)}</ul>
              </div>
            )}
          </section>
        </div>

        <section>
          <h4 className="text-[15px] font-semibold text-[var(--text)] mb-2">Linha do tempo <span className="font-normal text-[var(--text-muted)]">· {linha.length} registros</span></h4>
          <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
            {TIPOS.map((t) => {
              const n = t.valor === 'todos' ? linha.length : linha.filter((e) => e.tipo === t.valor || (t.valor === 'login' && e.tipo === 'logout')).length;
              if (t.valor !== 'todos' && n === 0) return null;
              return <button key={t.valor} type="button" onClick={() => { setTipo(t.valor); setMostrar(50); }} aria-pressed={tipo === t.valor}
                className={`shrink-0 h-9 px-3 rounded-full text-[13px] font-semibold u-press-sm ${tipo === t.valor ? 'bg-[var(--brand-fill)] text-white' : 'bg-[var(--surface-2)] text-[var(--text)]'}`}>{t.rotulo} <span className="opacity-70 num">{n}</span></button>;
            })}
          </div>
          {filtrada.length === 0 ? <p className="text-[14px] text-[var(--text-muted)] py-4 text-center">Nada aqui neste período.</p> : (
            <ol className="relative border-l-2 border-[var(--border)] ml-3 space-y-0">
              {filtrada.slice(0, mostrar).map((e, i) => {
                const dia = diaBr(e.quando); const mostraDia = dia !== diaAnterior; diaAnterior = dia;
                return (
                  <li key={i} className="pl-5 relative">
                    {mostraDia && <p className="-ml-5 pl-5 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-[0.03em] text-[var(--text-muted)]">{dia}</p>}
                    <span className="absolute -left-[13px] mt-2.5 w-6 h-6 grid place-items-center rounded-full bg-[var(--surface)] border-2" style={{ borderColor: COR[e.tipo] ?? 'var(--border)', color: COR[e.tipo] ?? 'var(--text-muted)', top: mostraDia ? 28 : 0 }}>{ICONE[e.tipo]}</span>
                    <div className="flex items-start justify-between gap-3 py-2">
                      <p className="text-[14px] text-[var(--text)] min-w-0"><span className="num text-[var(--text-muted)] mr-2">{horaBr(e.quando)}</span>{e.texto}</p>
                      {e.valor != null && <span className={`text-[14px] font-semibold num shrink-0 ${e.tipo === 'cancelou' ? 'text-[var(--err)]' : 'text-[var(--text)]'}`}>{brl(e.valor)}</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {filtrada.length > mostrar && <Button variant="secondary" className="w-full mt-3" onClick={() => setMostrar((m) => m + 50)}>Mostrar mais ({filtrada.length - mostrar} restantes)</Button>}
        </section>
      </div>
    </Modal>
  );
};
