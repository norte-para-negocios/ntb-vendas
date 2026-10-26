// Painel completo da aba Relatórios (25/10/2026, pedido do dono: "ver tudo, por categoria, clicar e ver todas as listas,
// baixar PDF de tudo, um dashboard completo"). Contas em lib/reports/analiseVendas.ts; aqui só desenho e cliques.
'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';
import { AlertTriangle, BarChart3, ChevronRight, Download, FileText, Layers, Printer, Receipt, Search, ShoppingBag, Store, Users, Wallet, X } from 'lucide-react';
import { Button, Card, Input, SegmentedControl } from '@/components/ui';
import { toast } from '@/components/Toast';
import { fetchMenu, fetchSalesHistory } from '@/lib/api';
import { formatBRL } from '@/lib/calc';
import { configTaxaDaLoja } from '@/lib/faturamento';
import { opcoesDoFiltro, filtroDoValor } from '@/lib/rankingProdutos';
import { printRelatorioCompleto } from '@/lib/print';
import { periodoDoPreset, periodoAnterior, rotuloDoPeriodo, type PresetPeriodo } from '@/lib/reports/periodo';
import { carregarVendasPeriodo } from '@/lib/reports/carregarVendasPeriodo';
import { analisarVendas, contasDoRecorte, opcoesDosFiltros, FILTROS_VAZIOS, type Analise, type ContaResumo, type FiltrosRelatorio, type Recorte } from '@/lib/reports/analiseVendas';
import type { SecaoRelatorio } from '@/lib/reports/relatorioCompletoHtml';
import { montarPainelDeVendas } from '@/lib/reports/painelDia';
import { buildFechamentoWorkbook } from '@/lib/reports/fechamentoXlsx';
import { baixarWorkbook } from '@/lib/reports/baixar';
import type { Category, CategoryGroup, Order } from '@/types';
import { ListaDeContas, ListaDetalhe } from './ListaDetalhe';

const PRESETS: { value: PresetPeriodo; label: string }[] = [
  { value: 'hoje', label: 'Hoje' }, { value: 'ontem', label: 'Ontem' }, { value: '7d', label: '7 dias' }, { value: '30d', label: '30 dias' },
  { value: 'mes', label: 'Este mês' }, { value: 'mes_passado', label: 'Mês passado' }, { value: 'personalizado', label: 'Escolher datas' },
];
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const tooltipStyle = { background: 'var(--surface)', border: 'none', borderRadius: 12, boxShadow: 'var(--shadow-md)', color: 'var(--text)' };
const cardCls = 'p-5 bg-[var(--surface)]';
const h4Cls = 'text-[15px] font-semibold text-[var(--text)]';
const selectCls = 'block w-full h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]';
const brl = (n: number) => `R$ ${formatBRL(n)}`;
const diaCurto = (d: string) => new Date(`${d}T12:00:00-03:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

function Variacao({ atual, anterior }: { atual: number; anterior: number | null }) {
  if (anterior == null) return null;
  if (anterior <= 0) return <span className="text-[12px] text-[var(--text-muted)]">sem base anterior</span>;
  const p = ((atual - anterior) / anterior) * 100;
  const sobe = p >= 0;
  return <span className={`text-[12px] font-semibold num ${sobe ? 'text-[var(--ok)]' : 'text-[var(--err)]'}`}>{sobe ? '▲' : '▼'} {Math.abs(p).toFixed(0)}% vs. anterior</span>;
}

function Kpi({ rotulo, valor, atual, anterior }: { rotulo: string; valor: string; atual?: number; anterior?: number | null }) {
  return (
    <Card className="p-4 bg-[var(--surface)]">
      <p className="text-[12px] font-semibold uppercase tracking-[0.03em] text-[var(--text-muted)]">{rotulo}</p>
      <p className="mt-1 text-[24px] max-sm:text-[19px] font-bold tracking-[-0.02em] num text-[var(--text)] whitespace-nowrap">{valor}</p>
      {atual != null && anterior !== undefined && <Variacao atual={atual} anterior={anterior} />}
    </Card>
  );
}

function CabecalhoSecao({ icone, titulo, sub, onPdf }: { icone: React.ReactNode; titulo: string; sub?: string; onPdf?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h4 className={`${h4Cls} flex items-center gap-2`}>{icone}{titulo}</h4>
        {sub && <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
      </div>
      {onPdf && <button type="button" onClick={onPdf} title="PDF desta seção" aria-label={`PDF de ${titulo}`} className="shrink-0 h-9 px-3 rounded-full bg-[var(--surface-2)] text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1.5 u-press"><Printer size={14} /> PDF</button>}
    </div>
  );
}

function LinhaBarra({ rotulo, sub, valor, extra, frac, onClick }: { rotulo: string; sub?: string; valor: string; extra?: string; frac: number; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left px-3 py-2.5 rounded-[12px] hover:bg-[var(--surface-2)] u-motion group">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] text-[var(--text)] truncate min-w-0">{rotulo}{sub && <span className="text-[12px] text-[var(--text-muted)] max-sm:hidden"> · {sub}</span>}</span>
        <span className="shrink-0 flex items-center gap-2">
          {extra && <span className="text-[12px] text-[var(--text-muted)] num max-sm:hidden">{extra}</span>}
          <span className="text-[14px] font-semibold num text-[var(--text)]">{valor}</span>
          <ChevronRight size={14} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100" />
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full bg-[var(--brand)]/70" style={{ width: `${Math.max(2, Math.min(100, frac * 100))}%` }} /></div>
    </button>
  );
}

const SemDados = ({ texto = 'Nada neste período' }: { texto?: string }) => (
  <div className="py-8 flex flex-col items-center gap-2 text-center"><span className="w-10 h-10 grid place-items-center rounded-full bg-[var(--surface-2)]"><BarChart3 size={18} className="text-[var(--text-muted)]" /></span><p className="text-[14px] text-[var(--text-muted)]">{texto}</p></div>
);

export const RelatoriosPainel: React.FC<{ storeId: string; storeName: string; storeSlug: string; userName: string; storeConfig?: Record<string, unknown> | null }> = ({ storeId, storeName, storeSlug, userName, storeConfig }) => {
  const [preset, setPreset] = useState<PresetPeriodo>('hoje');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const periodo = useMemo(() => periodoDoPreset(preset, new Date(), de || undefined, ate || undefined), [preset, de, ate]);
  const [filtros, setFiltros] = useState<FiltrosRelatorio>(FILTROS_VAZIOS);
  const [valorCategoria, setValorCategoria] = useState('todas');
  const [vendas, setVendas] = useState<Order[]>([]);
  const [anteriores, setAnteriores] = useState<Order[] | null>(null);
  const [diasCortados, setDiasCortados] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<Category[]>([]);
  const [grupos, setGrupos] = useState<CategoryGroup[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [abaProdutos, setAbaProdutos] = useState<'mais' | 'menos' | 'valor'>('mais');
  const [buscaProduto, setBuscaProduto] = useState('');
  const [todosProdutos, setTodosProdutos] = useState(false);
  const [lista, setLista] = useState<{ titulo: string; contas: ContaResumo[] } | null>(null);
  const [gerando, setGerando] = useState(false);
  const pedido = useRef(0);
  const cfgTaxa = useMemo(() => configTaxaDaLoja(storeConfig as never), [storeConfig]);

  useEffect(() => {
    fetchMenu(storeId, false, true).then((m) => { setCategorias(m.categories); setGrupos(m.categoryGroups); }).catch(() => {});
  }, [storeId]);

  useEffect(() => {
    if (!periodo.de || !periodo.ate || periodo.ate < periodo.de) return;
    const meu = ++pedido.current;
    setCarregando(true); setErro(null); setAnteriores(null);
    const buscar = (ini: string, fim: string) => fetchSalesHistory(storeId, ini, fim, () => { throw new Error('falha'); });
    carregarVendasPeriodo(buscar, periodo.de, periodo.ate)
      .then((r) => {
        if (meu !== pedido.current) return;
        setVendas(r.vendas); setDiasCortados(r.diasCortados);
        const ant = periodoAnterior(periodo.de, periodo.ate);
        return carregarVendasPeriodo(buscar, ant.de, ant.ate).then((a) => { if (meu === pedido.current) setAnteriores(a.vendas); }).catch(() => {});
      })
      .catch((e) => {
        if (meu !== pedido.current) return;
        console.error('Relatórios: falha ao carregar vendas', e);
        setErro(e instanceof Error && e.message === 'periodo-longo' ? 'Escolha no máximo 366 dias.' : 'Não consegui carregar as vendas. Confira a internet e tente de novo.');
      })
      .finally(() => { if (meu === pedido.current) setCarregando(false); });
  }, [storeId, periodo.de, periodo.ate]);

  const analise: Analise = useMemo(() => analisarVendas(vendas, categorias, filtros, cfgTaxa), [vendas, categorias, filtros, cfgTaxa]);
  const analiseAnt = useMemo(() => (anteriores ? analisarVendas(anteriores, categorias, filtros, cfgTaxa) : null), [anteriores, categorias, filtros, cfgTaxa]);
  const opcoes = useMemo(() => opcoesDosFiltros(vendas), [vendas]);
  const opcoesCategoria = useMemo(() => opcoesDoFiltro(categorias as never, grupos as never), [categorias, grupos]);
  const meta = (titulo?: string) => ({ loja: storeName, periodoLabel: rotuloDoPeriodo(periodo.de, periodo.ate) + (filtrosAtivos() ? ` · ${filtrosAtivos()}` : ''), geradoEm: new Date(), geradoPor: userName, titulo });
  function filtrosAtivos(): string {
    const p: string[] = [];
    if (valorCategoria !== 'todas') p.push(opcoesCategoria.find((o) => o.value === valorCategoria)?.label.replace(/^— /, '') ?? '');
    if (filtros.operador) p.push(filtros.operador);
    if (filtros.forma) p.push(opcoes.formas.find((f) => f.chave === filtros.forma)?.rotulo ?? filtros.forma);
    if (filtros.tipo !== 'todos') p.push(filtros.tipo === 'mesa' ? 'Só mesas' : 'Só balcão');
    return p.filter(Boolean).join(' · ');
  }

  const abrirLista = (titulo: string, r: Recorte) => setLista({ titulo, contas: contasDoRecorte(vendas, categorias, filtros, r) });
  const pdf = async (secoes?: SecaoRelatorio[], titulo?: string) => {
    const ok = await printRelatorioCompleto(analise, meta(titulo), secoes).catch(() => false);
    if (!ok) toast.error('Não consegui abrir a impressão. Confira o bloqueador de janelas.');
  };
  const excel = async () => {
    setGerando(true);
    try {
      const nomes = new Map(categorias.map((c) => [c.id, c.name]));
      const nomeCat = (id: string) => nomes.get(id);
      const m = meta('Relatório de vendas');
      const wb = await buildFechamentoWorkbook({ ...m, painel: montarPainelDeVendas(vendas, nomeCat), nomeCategoria: nomeCat, turnos: [], vendas, excecoes: [] } as never);
      await baixarWorkbook(wb, `relatorio-${storeSlug}-${periodo.de}${periodo.ate !== periodo.de ? `_a_${periodo.ate}` : ''}.xlsx`);
      toast.success('Arquivo gerado.');
    } catch (e) { console.error('Relatórios excel', e); toast.error('Não consegui gerar o arquivo.'); }
    finally { setGerando(false); }
  };
  const limparFiltros = () => { setFiltros(FILTROS_VAZIOS); setValorCategoria('todas'); };

  const umDia = periodo.de === periodo.ate;
  const serie = umDia
    ? analise.porHora.map((h) => ({ chave: String(h.hora), rotulo: `${String(h.hora).padStart(2, '0')}h`, total: h.total, contas: h.contas }))
    : analise.porDia.map((d) => ({ chave: d.dia, rotulo: diaCurto(d.dia), total: d.total, contas: d.contas }));
  const clicarBarra = (i: number) => {
    const p = serie[i]; if (!p) return;
    if (umDia) abrirLista(`Contas das ${p.rotulo}`, { hora: Number(p.chave) });
    else { setPreset('personalizado'); setDe(p.chave); setAte(p.chave); }
  };
  const k = analise.kpis; const ka = analiseAnt?.kpis ?? null;
  const produtosVistos = useMemo(() => {
    const t = buscaProduto.trim().toLowerCase();
    let l = analise.produtos.filter((p) => !t || p.nome.toLowerCase().includes(t) || p.categoria.toLowerCase().includes(t));
    if (abaProdutos === 'menos') l = l.slice().reverse();
    if (abaProdutos === 'valor') l = l.slice().sort((a, b) => b.total - a.total);
    return l;
  }, [analise.produtos, abaProdutos, buscaProduto]);
  const maxProd = Math.max(1, ...produtosVistos.map((p) => (abaProdutos === 'valor' ? p.total : p.qtd)));
  const max = <T,>(xs: T[], f: (x: T) => number) => Math.max(1, ...xs.map(f));

  return (
    <div className="space-y-4">
      {/* Período e filtros */}
      <Card className={`${cardCls} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-semibold text-[var(--text)]">Relatório de vendas</h3>
            <p className="text-[13px] text-[var(--text-muted)]">{periodo.rotulo === rotuloDoPeriodo(periodo.de, periodo.ate) ? periodo.rotulo : `${periodo.rotulo} · ${rotuloDoPeriodo(periodo.de, periodo.ate)}`}{carregando ? ' · carregando…' : ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => pdf(undefined, 'Relatório completo')} disabled={carregando}><FileText size={16} /> PDF completo</Button>
            <Button variant="secondary" onClick={excel} isLoading={gerando} disabled={carregando}><Download size={16} /> Excel</Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Período">
          {PRESETS.map((p) => (
            <button key={p.value} type="button" role="radio" aria-checked={preset === p.value} onClick={() => { setPreset(p.value); if (p.value === 'personalizado' && !de) { setDe(periodo.de); setAte(periodo.ate); } }}
              className={`min-h-10 px-4 rounded-full text-[14px] font-semibold u-motion u-press-sm ${preset === p.value ? 'bg-[var(--brand-fill)] text-white' : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)]'}`}>{p.label}</button>
          ))}
        </div>
        {preset === 'personalizado' && (
          <div className="flex flex-wrap gap-3">
            <label className="text-[13px] text-[var(--text-muted)]">De<Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
            <label className="text-[13px] text-[var(--text-muted)]">Até<Input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} /></label>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-[13px] text-[var(--text-muted)]">Categoria
            <select className={selectCls} value={valorCategoria} onChange={(e) => { setValorCategoria(e.target.value); setFiltros((f) => ({ ...f, categoria: filtroDoValor(e.target.value) })); }}>
              {opcoesCategoria.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-[13px] text-[var(--text-muted)]">Quem lançou
            <select className={selectCls} value={filtros.operador ?? ''} onChange={(e) => setFiltros((f) => ({ ...f, operador: e.target.value || null }))}>
              <option value="">Todos</option>
              {opcoes.pessoas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-[13px] text-[var(--text-muted)]">Forma de pagamento
            <select className={selectCls} value={filtros.forma ?? ''} onChange={(e) => setFiltros((f) => ({ ...f, forma: e.target.value || null }))}>
              <option value="">Todas</option>
              {opcoes.formas.map((f) => <option key={f.chave} value={f.chave}>{f.rotulo}</option>)}
            </select>
          </label>
          <label className="text-[13px] text-[var(--text-muted)]">Onde
            <select className={selectCls} value={filtros.tipo} onChange={(e) => setFiltros((f) => ({ ...f, tipo: e.target.value as FiltrosRelatorio['tipo'] }))}>
              <option value="todos">Mesas e balcão</option><option value="mesa">Só mesas</option><option value="balcao">Só balcão</option>
            </select>
          </label>
        </div>
        {filtrosAtivos() && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-[var(--text-muted)]">Filtrando:</span><span className="font-semibold text-[var(--text)]">{filtrosAtivos()}</span>
            <button type="button" onClick={limparFiltros} className="h-8 px-3 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1 u-press-sm"><X size={13} /> Limpar</button>
            {analise.modoItens && <span className="text-[var(--text-muted)]">· valores = soma dos itens filtrados (sem taxa)</span>}
          </div>
        )}
        {erro && <p className="text-[14px] text-[var(--err)] flex items-center gap-2"><AlertTriangle size={15} /> {erro}</p>}
        {diasCortados.length > 0 && <p className="text-[13px] text-[var(--warn)] flex items-center gap-2"><AlertTriangle size={14} /> Dados podem estar incompletos em {diasCortados.map(diaCurto).join(', ')} (muitos pedidos no dia).</p>}
      </Card>

      {/* Indicadores */}
      <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 ${carregando ? 'opacity-60' : ''}`}>
        <Kpi rotulo={analise.modoItens ? 'Vendido (filtro)' : 'Faturamento'} valor={brl(k.faturamento)} atual={k.faturamento} anterior={ka ? ka.faturamento : null} />
        <Kpi rotulo="Contas" valor={String(k.contas)} atual={k.contas} anterior={ka ? ka.contas : null} />
        <Kpi rotulo="Ticket médio" valor={brl(k.ticket)} atual={k.ticket} anterior={ka ? ka.ticket : null} />
        <Kpi rotulo="Itens vendidos" valor={String(k.itens)} atual={k.itens} anterior={ka ? ka.itens : null} />
        {!analise.modoItens && <Kpi rotulo="Taxa de serviço" valor={brl(k.taxaServico)} />}
        {!analise.modoItens && <Kpi rotulo="Cortesias" valor={brl(k.cortesia)} />}
        <Kpi rotulo="Itens cancelados" valor={String(k.cancelados.qtd)} />
        <Kpi rotulo="Valor cancelado" valor={brl(k.cancelados.valor)} />
      </div>

      {/* Evolução */}
      <Card className={cardCls}>
        <CabecalhoSecao icone={<Receipt size={17} className="text-[var(--text-muted)]" />} titulo={umDia ? 'Faturamento por hora' : 'Faturamento por dia'} sub={umDia ? 'Toque numa barra para ver as contas daquela hora.' : 'Toque num dia para ver só aquele dia.'} onPdf={() => pdf([umDia ? 'horas' : 'dias'])} />
        <div className="h-64">
          {serie.length === 0 ? <SemDados /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="rotulo" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `R$${v}`} width={64} />
                <RechartsTooltip cursor={{ fill: 'var(--surface-2)' }} formatter={(v: unknown, _n: unknown, it: { payload?: { contas?: number } }) => [`${brl(Number(v))} · ${it?.payload?.contas ?? 0} contas`, 'Total']} contentStyle={tooltipStyle} />
                <Bar dataKey="total" radius={[6, 6, 0, 0]} className="cursor-pointer" onClick={(_d: unknown, i: number) => clicarBarra(i)}>{serie.map((s) => <Cell key={s.chave} fill="var(--brand)" />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        {!umDia && analise.porDiaSemana.length > 0 && (
          <div className="mt-4 grid grid-cols-7 gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => { const v = analise.porDiaSemana.find((x) => x.dia === d); const mx = max(analise.porDiaSemana, (x) => x.total); return (
              <div key={d} className="text-center">
                <div className="h-16 flex items-end"><div className="w-full rounded-t-md bg-[var(--brand)]/60" style={{ height: `${v ? Math.max(4, (v.total / mx) * 100) : 0}%` }} /></div>
                <p className="text-[12px] font-semibold text-[var(--text)] mt-1">{DIAS_SEMANA[d]}</p>
                <p className="text-[11px] text-[var(--text-muted)] num max-sm:hidden">{v ? brl(v.total) : '—'}</p>
              </div>
            ); })}
          </div>
        )}
      </Card>

      {/* Produtos */}
      <Card className={cardCls}>
        <CabecalhoSecao icone={<ShoppingBag size={17} className="text-[var(--text-muted)]" />} titulo="Produtos" sub={`${analise.produtos.length} produtos vendidos · toque num produto para ver as vendas dele`} onPdf={() => pdf(['produtos'], 'Produtos vendidos')} />
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="max-w-full overflow-x-auto"><SegmentedControl value={abaProdutos} onChange={(v) => setAbaProdutos(v as typeof abaProdutos)} options={[{ value: 'mais', label: 'Mais vendidos' }, { value: 'menos', label: 'Menos vendidos' }, { value: 'valor', label: 'Maior faturamento' }]} /></div>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-[var(--text-muted)] pointer-events-none" />
            <Input aria-label="Buscar produto" placeholder="Buscar produto ou categoria" value={buscaProduto} onChange={(e) => setBuscaProduto(e.target.value)} className="!pl-9" />
          </div>
        </div>
        {produtosVistos.length === 0 ? <SemDados /> : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6">
            {produtosVistos.slice(0, todosProdutos ? undefined : 16).map((p, i) => (
              <LinhaBarra key={p.chave} rotulo={`${abaProdutos === 'menos' ? '' : `${i + 1}. `}${p.nome}`} sub={p.categoria} valor={abaProdutos === 'valor' ? brl(p.total) : `${p.qtd} un.`} extra={abaProdutos === 'valor' ? `${p.qtd} un.` : brl(p.total)}
                frac={(abaProdutos === 'valor' ? p.total : p.qtd) / maxProd} onClick={() => abrirLista(`Vendas de ${p.nome}`, { produto: p.chave })} />
            ))}
          </div>
        )}
        {produtosVistos.length > 16 && <Button variant="secondary" className="w-full mt-3" onClick={() => setTodosProdutos((v) => !v)}>{todosProdutos ? 'Mostrar menos' : `Ver todos os ${produtosVistos.length} produtos`}</Button>}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className={cardCls}>
          <CabecalhoSecao icone={<Layers size={17} className="text-[var(--text-muted)]" />} titulo="Categorias" sub="Toque para filtrar o relatório por ela" onPdf={() => pdf(['categorias'])} />
          {analise.categorias.length === 0 ? <SemDados /> : analise.categorias.map((c) => (
            <LinhaBarra key={c.id} rotulo={c.nome} valor={brl(c.total)} extra={`${c.qtd} un. · ${c.pct.toFixed(0)}%`} frac={c.pct / 100}
              onClick={() => { if (c.id === '_sem') { abrirLista('Vendas sem categoria', { categoria: '_sem' }); return; } setValorCategoria(`c:${c.id}`); setFiltros((f) => ({ ...f, categoria: { tipo: 'categoria', id: c.id } })); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
          ))}
        </Card>
        <Card className={cardCls}>
          <CabecalhoSecao icone={<Wallet size={17} className="text-[var(--text-muted)]" />} titulo="Formas de pagamento" sub="Toque para ver as contas" onPdf={() => pdf(['formas'])} />
          {analise.formas.length === 0 ? <SemDados /> : analise.formas.map((f) => (
            <LinhaBarra key={f.chave} rotulo={f.rotulo} valor={brl(f.total)} extra={`${f.contas} contas`} frac={f.total / max(analise.formas, (x) => x.total)} onClick={() => abrirLista(`Contas pagas em ${f.rotulo}`, { forma: f.chave })} />
          ))}
        </Card>
        <Card className={cardCls}>
          <CabecalhoSecao icone={<Users size={17} className="text-[var(--text-muted)]" />} titulo="Equipe" sub="Quem lançou os itens · toque para ver as vendas" onPdf={() => pdf(['equipe'])} />
          {analise.equipe.length === 0 ? <SemDados /> : analise.equipe.map((e) => (
            <LinhaBarra key={e.nome} rotulo={e.nome} valor={brl(e.total)} extra={`${e.itens} itens · ${e.contas} contas`} frac={e.total / max(analise.equipe, (x) => x.total)} onClick={() => abrirLista(`Vendas lançadas por ${e.nome}`, { pessoa: e.nome })} />
          ))}
        </Card>
        <Card className={cardCls}>
          <CabecalhoSecao icone={<Store size={17} className="text-[var(--text-muted)]" />} titulo="Mesas e balcão" sub="Toque para ver as contas" onPdf={() => pdf(['mesas'])} />
          {analise.mesas.length === 0 ? <SemDados /> : (
            <div className="max-h-[420px] overflow-y-auto pr-1">{analise.mesas.map((m) => (
              <LinhaBarra key={m.rotulo} rotulo={m.rotulo} valor={brl(m.total)} extra={`${m.contas} contas · ticket ${brl(m.ticket)}`} frac={m.total / max(analise.mesas, (x) => x.total)} onClick={() => abrirLista(`Contas de ${m.rotulo}`, { local: m.rotulo })} />
            ))}</div>
          )}
        </Card>
      </div>

      <Card className={cardCls}>
        <CabecalhoSecao icone={<Receipt size={17} className="text-[var(--text-muted)]" />} titulo="Todas as contas" sub={`${analise.contas.length} contas · toque para ver os itens`} onPdf={() => pdf(['contas'], 'Contas do período')} />
        <ListaDeContas contas={analise.contas} limite={30} />
      </Card>

      <ListaDetalhe titulo={lista?.titulo ?? null} contas={lista?.contas ?? []} meta={meta(lista?.titulo)} onClose={() => setLista(null)} />
    </div>
  );
};
