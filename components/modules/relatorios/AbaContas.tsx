// Aba "Contas" dos Relatórios v2 (26/10/2026): todas as contas do período, com ordem e busca.
'use client';
import React, { useMemo, useState } from 'react';
import { Receipt } from 'lucide-react';
import { Card, SegmentedControl } from '@/components/ui';
import { ListaDeContas } from './ListaDetalhe';
import { CabecalhoSecao, Barras, brl, cardCls } from './graficos';
import type { PropsAba } from './tipos';

// Faixas de valor das contas (para ver se a loja vive de conta pequena ou grande).
const FAIXAS = [[0, 50], [50, 100], [100, 200], [200, 400], [400, 800], [800, Infinity]] as const;

export const AbaContas: React.FC<PropsAba> = ({ analise, pdf }) => {
  const [ordem, setOrdem] = useState<'recentes' | 'maiores' | 'menores'>('recentes');
  const contas = useMemo(() => {
    if (ordem === 'maiores') return analise.contas.slice().sort((a, b) => b.total - a.total);
    if (ordem === 'menores') return analise.contas.slice().sort((a, b) => a.total - b.total);
    return analise.contas;
  }, [analise.contas, ordem]);
  const faixas = FAIXAS.map(([de, ate]) => ({ rotulo: ate === Infinity ? `+${de}` : `${de}–${ate}`, valor: analise.contas.filter((c) => c.total >= de && c.total < ate).length }));

  return (
    <div className="space-y-4">
      <Card className={cardCls}>
        <CabecalhoSecao icone={<Receipt size={17} className="text-[var(--text-muted)]" />} titulo="Tamanho das contas" sub={`Quantas contas em cada faixa de valor (R$) · ticket médio ${brl(analise.kpis.ticket)}`} />
        <Barras dados={faixas.map((f) => ({ ...f, extra: 'contas' }))} formatar={(n) => `${n}`} altura={200} />
      </Card>
      <Card className={cardCls}>
        <CabecalhoSecao icone={<Receipt size={17} className="text-[var(--text-muted)]" />} titulo="Todas as contas" sub={`${analise.contas.length} contas · toque para ver os itens`} onPdf={() => pdf(['contas'], 'Contas do período')}
          acao={<div className="max-sm:hidden"><SegmentedControl value={ordem} onChange={(v) => setOrdem(v as typeof ordem)} options={[{ value: 'recentes', label: 'Recentes' }, { value: 'maiores', label: 'Maiores' }, { value: 'menores', label: 'Menores' }]} /></div>} />
        <div className="sm:hidden mb-3"><SegmentedControl value={ordem} onChange={(v) => setOrdem(v as typeof ordem)} options={[{ value: 'recentes', label: 'Recentes' }, { value: 'maiores', label: 'Maiores' }, { value: 'menores', label: 'Menores' }]} /></div>
        <ListaDeContas contas={contas} limite={50} />
      </Card>
    </div>
  );
};
