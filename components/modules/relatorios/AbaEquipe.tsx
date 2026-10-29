// Aba "Equipe" dos Relatórios v2 (26/10/2026, pedido do dono: "ver por login o que cada pessoa fez, o que cada pessoa
// lançou"). Um cartão por pessoa com lançou/recebeu/cancelou/tempo logado; toque abre tudo o que ela fez.
'use client';
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock, LogIn, Printer, Receipt, Search, ShoppingBag, Users, XCircle } from 'lucide-react';
import { Button, Card, Input, SegmentedControl } from '@/components/ui';
import { getRoleLabel } from '@/lib/labels';
import type { Pessoa } from '@/lib/reports/analiseEquipe';
import { duracao } from '@/lib/reports/relatorioEquipeHtml';
import { BarrasEquipe, CabecalhoSecao, KpiHero, MiniHoras, SemDados, brl, cardCls, COLORS } from './graficos';

type Ordem = 'movimento' | 'lancou' | 'recebeu' | 'tempo' | 'cancelou';
const CORES_AVATAR = ['var(--brand)', 'var(--info)', 'var(--ok)', 'var(--warn)'];
export const papelDe = (papel: string | null) => (!papel ? 'Equipe' : papel === 'universal' ? 'Conta da Norte' : papel === 'open' ? 'Garçom' : papel === 'cliente' ? 'Pedidos feitos pelo cliente no celular' : getRoleLabel(papel));
export const iniciais = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');

export function Avatar({ nome, i, grande = false }: { nome: string; i: number; grande?: boolean }) {
  return <span className={`${grande ? 'w-14 h-14 text-[20px]' : 'w-11 h-11 text-[15px]'} shrink-0 grid place-items-center rounded-full font-bold text-white`} style={{ background: CORES_AVATAR[i % CORES_AVATAR.length] }} aria-hidden>{iniciais(nome)}</span>;
}

function Dado({ icone, rotulo, valor, sub, alerta }: { icone: React.ReactNode; rotulo: string; valor: string; sub?: string; alerta?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.03em] text-[var(--text-muted)]">{icone}{rotulo}</p>
      <p className={`text-[16px] font-bold num truncate ${alerta ? 'text-[var(--err)]' : 'text-[var(--text)]'}`}>{valor}</p>
      {sub && <p className="text-[12px] text-[var(--text-muted)] num truncate">{sub}</p>}
    </div>
  );
}

export const AbaEquipe: React.FC<{
  pessoas: Pessoa[];
  aparelhos: { nome: string; eventos: number }[];
  atividadeOk: boolean | null;
  cortado: boolean;
  carregandoAtividade: boolean;
  abrirPessoa: (nome: string) => void;
  pdfEquipe: () => void;
}> = ({ pessoas, aparelhos, atividadeOk, cortado, carregandoAtividade, abrirPessoa, pdfEquipe }) => {
  const [ordem, setOrdem] = useState<Ordem>('movimento');
  const [busca, setBusca] = useState('');
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const l = pessoas.filter((p) => !t || p.nome.toLowerCase().includes(t));
    const k: Record<Ordem, (p: Pessoa) => number> = {
      movimento: (p) => p.lancou.valor + p.recebeu.valor, lancou: (p) => p.lancou.valor, recebeu: (p) => p.recebeu.valor,
      tempo: (p) => p.login.minutos, cancelou: (p) => p.excecoes.cancelados.qtd * 1e6 + p.excecoes.cancelados.valor,
    };
    return l.slice().sort((a, b) => k[ordem](b) - k[ordem](a) || a.nome.localeCompare(b.nome));
  }, [pessoas, ordem, busca]);
  const indice = new Map(pessoas.map((p, i) => [p.nome, i]));
  const tot = pessoas.reduce((s, p) => ({ lancou: s.lancou + p.lancou.valor, recebeu: s.recebeu + p.recebeu.valor, min: s.min + p.login.minutos, canc: s.canc + p.excecoes.cancelados.qtd, cancV: s.cancV + p.excecoes.cancelados.valor }), { lancou: 0, recebeu: 0, min: 0, canc: 0, cancV: 0 });
  const comVenda = pessoas.filter((p) => p.lancou.valor > 0 || p.recebeu.valor > 0).slice(0, 12);

  return (
    <div className="space-y-4">
      {atividadeOk === false && <p className="text-[13px] text-[var(--warn)] flex items-center gap-2"><AlertTriangle size={14} /> Entradas no sistema e pré-contas indisponíveis agora. Vendas e recebimentos estão completos.</p>}
      {cortado && <p className="text-[13px] text-[var(--warn)] flex items-center gap-2"><AlertTriangle size={14} /> Período com muita atividade: entradas e pré-contas mostram só os primeiros 5.000 registros. Escolha um período menor para ver tudo.</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiHero rotulo="Pessoas trabalhando" valor={pessoas.length} formato="int" icone={<Users size={15} />} sub={`${pessoas.filter((p) => p.login.entradas > 0).length} entraram no sistema`} />
        <KpiHero rotulo="Lançado pela equipe" valor={tot.lancou} cor="var(--info)" icone={<ShoppingBag size={15} />} sub="soma dos itens lançados" />
        <KpiHero rotulo="Recebido pela equipe" valor={tot.recebeu} cor="var(--ok)" icone={<Receipt size={15} />} sub="contas fechadas no caixa" />
        <KpiHero rotulo="Itens cancelados" valor={tot.canc} formato="int" cor="var(--err)" icone={<XCircle size={15} />} sub={tot.canc ? `${brl(tot.cancV)} em itens` : 'nenhum'} />
      </div>

      <Card className={cardCls}>
        <CabecalhoSecao icone={<Users size={17} className="text-[var(--text-muted)]" />} titulo="Lançou × recebeu, por pessoa" sub="Garçom lança os itens; caixa recebe as contas · toque numa barra para abrir a pessoa" onPdf={pdfEquipe} />
        <BarrasEquipe dados={comVenda.map((p) => ({ nome: p.nome, lancou: p.lancou.valor, recebeu: p.recebeu.valor }))} onClick={abrirPessoa} />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-full overflow-x-auto"><SegmentedControl value={ordem} onChange={(v) => setOrdem(v as Ordem)} options={[{ value: 'movimento', label: 'Movimento' }, { value: 'lancou', label: 'Lançou' }, { value: 'recebeu', label: 'Recebeu' }, { value: 'tempo', label: 'Tempo logado' }, { value: 'cancelou', label: 'Cancelou' }]} /></div>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-[var(--text-muted)] pointer-events-none" />
          <Input aria-label="Buscar pessoa" placeholder="Buscar pessoa" value={busca} onChange={(e) => setBusca(e.target.value)} className="!pl-9" />
        </div>
        <Button variant="secondary" onClick={pdfEquipe} disabled={pessoas.length === 0}><Printer size={15} /> PDF da equipe</Button>
      </div>

      {lista.length === 0 ? <Card className={cardCls}><SemDados texto={carregandoAtividade ? 'Carregando a equipe…' : 'Ninguém trabalhou neste período'} /></Card> : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
          {lista.map((p) => (
            <button key={p.nome} type="button" onClick={() => abrirPessoa(p.nome)} className="text-left rounded-[20px] bg-[var(--surface)] border border-[var(--border)] p-4 hover:border-[var(--brand)] hover:shadow-[var(--shadow-md)] u-motion u-press-sm min-w-0">
              <div className="flex items-center gap-3">
                <Avatar nome={p.nome} i={indice.get(p.nome) ?? 0} />
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-semibold text-[var(--text)] truncate">{p.nome}</p>
                  <p className="text-[13px] text-[var(--text-muted)] truncate">{papelDe(p.papel)}{p.login.primeiro ? ` · entrou ${new Date(p.login.primeiro).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' })}` : ''}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 mt-4">
                <Dado icone={<ShoppingBag size={11} />} rotulo="Lançou" valor={brl(p.lancou.valor)} sub={`${p.lancou.itens} itens · ${p.lancou.mesas} mesas`} />
                <Dado icone={<Receipt size={11} />} rotulo="Recebeu" valor={brl(p.recebeu.valor)} sub={`${p.recebeu.contas} contas`} />
                <Dado icone={<Clock size={11} />} rotulo="Tempo logado" valor={duracao(p.login.minutos)} sub={`${p.login.entradas} ${p.login.entradas === 1 ? 'entrada' : 'entradas'} · ${p.preContas} pré-contas`} />
                <Dado icone={<XCircle size={11} />} rotulo="Cancelou" valor={String(p.excecoes.cancelados.qtd)} sub={p.excecoes.cancelados.qtd ? brl(p.excecoes.cancelados.valor) : 'nada'} alerta={p.excecoes.cancelados.qtd > 0} />
              </div>
              <div className="mt-3 pt-3 border-t border-[var(--border)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[var(--text-muted)] mb-1">Itens lançados por hora</p>
                <MiniHoras porHora={p.lancou.porHora} cor={COLORS[(indice.get(p.nome) ?? 0) % 3 === 1 ? 2 : 0]} />
              </div>
            </button>
          ))}
        </div>
      )}

      {aparelhos.length > 0 && (
        <p className="text-[12px] text-[var(--text-muted)] flex items-center gap-1.5"><LogIn size={12} /> Aparelhos (não são pessoas): {aparelhos.map((a) => `${a.nome} (${a.eventos})`).join(' · ')}</p>
      )}
    </div>
  );
};
