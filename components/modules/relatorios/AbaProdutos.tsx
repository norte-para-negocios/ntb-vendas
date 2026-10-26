// Aba "Produtos" dos Relatórios v2 (26/10/2026): ranking completo (mais/menos vendidos, faturamento, busca) e categorias.
'use client';
import React, { useMemo, useState } from 'react';
import { Layers, Search, ShoppingBag } from 'lucide-react';
import { Button, Card, Input, SegmentedControl } from '@/components/ui';
import { CabecalhoSecao, Ranking, Rosca, brl, cardCls } from './graficos';
import type { PropsAba } from './tipos';

export const AbaProdutos: React.FC<PropsAba> = ({ analise, abrirLista, pdf, filtrarCategoria }) => {
  const [aba, setAba] = useState<'mais' | 'menos' | 'valor'>('mais');
  const [busca, setBusca] = useState('');
  const [todos, setTodos] = useState(false);
  const vistos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    let l = analise.produtos.filter((p) => !t || p.nome.toLowerCase().includes(t) || p.categoria.toLowerCase().includes(t));
    if (aba === 'menos') l = l.slice().reverse();
    if (aba === 'valor') l = l.slice().sort((a, b) => b.total - a.total);
    return l;
  }, [analise.produtos, aba, busca]);
  const max = Math.max(1, ...vistos.map((p) => (aba === 'valor' ? p.total : p.qtd)));
  const maxCat = Math.max(1, ...analise.categorias.map((c) => c.total));
  const somaProd = analise.produtos.reduce((s, p) => s + p.total, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Produtos diferentes', String(analise.produtos.length)],
          ['Itens vendidos', String(analise.kpis.itens)],
          ['Vendido em produtos', brl(somaProd)],
          ['Preço médio por item', brl(analise.kpis.itens ? somaProd / analise.kpis.itens : 0)],
        ].map(([r, v]) => (
          <Card key={r} className="p-4 bg-[var(--surface)]"><p className="text-[12px] font-semibold uppercase tracking-[0.03em] text-[var(--text-muted)]">{r}</p><p className="mt-1 text-[22px] max-sm:text-[18px] font-bold num text-[var(--text)] whitespace-nowrap">{v}</p></Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className={cardCls}>
          <CabecalhoSecao icone={<Layers size={17} className="text-[var(--text-muted)]" />} titulo="Participação por categoria" sub="Toque para filtrar o relatório por ela" onPdf={() => pdf(['categorias'])} />
          <Rosca dados={analise.categorias.map((c) => ({ chave: c.id, rotulo: c.nome, valor: c.total }))} onClick={(id) => (id === '_sem' ? abrirLista('Vendas sem categoria', { categoria: '_sem' }) : filtrarCategoria(id))} />
        </Card>
        <Card className={cardCls}>
          <CabecalhoSecao icone={<Layers size={17} className="text-[var(--text-muted)]" />} titulo="Categorias" sub={`${analise.categorias.length} categorias com venda`} />
          <div className="max-h-[360px] overflow-y-auto pr-1">
            <Ranking dados={analise.categorias.map((c) => ({ chave: c.id, rotulo: c.nome, valor: brl(c.total), extra: `${c.qtd} un. · ${c.pct.toFixed(0)}%`, frac: c.total / maxCat }))} onClick={(id) => (id === '_sem' ? abrirLista('Vendas sem categoria', { categoria: '_sem' }) : filtrarCategoria(id))} />
          </div>
        </Card>
      </div>

      <Card className={cardCls}>
        <CabecalhoSecao icone={<ShoppingBag size={17} className="text-[var(--text-muted)]" />} titulo="Todos os produtos" sub={`${analise.produtos.length} produtos vendidos · toque num produto para ver as vendas dele`} onPdf={() => pdf(['produtos'], 'Produtos vendidos')} />
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="max-w-full overflow-x-auto"><SegmentedControl value={aba} onChange={(v) => setAba(v as typeof aba)} options={[{ value: 'mais', label: 'Mais vendidos' }, { value: 'menos', label: 'Menos vendidos' }, { value: 'valor', label: 'Maior faturamento' }]} /></div>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-[var(--text-muted)] pointer-events-none" />
            <Input aria-label="Buscar produto" placeholder="Buscar produto ou categoria" value={busca} onChange={(e) => setBusca(e.target.value)} className="!pl-9" />
          </div>
        </div>
        <Ranking duasColunas dados={vistos.slice(0, todos ? undefined : 30).map((p) => ({ chave: p.chave, rotulo: p.nome, sub: p.categoria, valor: aba === 'valor' ? brl(p.total) : `${p.qtd} un.`, extra: aba === 'valor' ? `${p.qtd} un.` : brl(p.total), frac: (aba === 'valor' ? p.total : p.qtd) / max }))}
          onClick={(c) => abrirLista(`Vendas de ${analise.produtos.find((p) => p.chave === c)?.nome ?? ''}`, { produto: c })} />
        {vistos.length > 30 && <Button variant="secondary" className="w-full mt-3" onClick={() => setTodos((v) => !v)}>{todos ? 'Mostrar menos' : `Ver todos os ${vistos.length} produtos`}</Button>}
      </Card>
    </div>
  );
};
