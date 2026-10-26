// Painel da aba Relatórios. v1 (25/10/2026): "ver tudo, por categoria, clicar e ver todas as listas, PDF de tudo".
// v2 (26/10/2026, "mais gráficos, tipo o Resumo, mais dados, ver por login o que cada pessoa fez"): 4 abas (Visão geral,
// Produtos, Equipe, Contas) com período e filtros em comum. Contas em lib/reports/; aqui só carga, abas e cliques.
'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, FileText, LayoutDashboard, Receipt, ShoppingBag, Users, X } from 'lucide-react';
import { Button, Card, Input } from '@/components/ui';
import { toast } from '@/components/Toast';
import { fetchAtividadeEquipe, fetchCheckinsHistory, fetchExceptionsReport, fetchMenu, fetchSalesHistory } from '@/lib/api';
import { configTaxaDaLoja } from '@/lib/faturamento';
import { opcoesDoFiltro, filtroDoValor } from '@/lib/rankingProdutos';
import { printEquipe, printPessoa, printRelatorioCompleto } from '@/lib/print';
import { periodoDoPreset, periodoAnterior, rotuloDoPeriodo, type PresetPeriodo } from '@/lib/reports/periodo';
import { carregarVendasPeriodo } from '@/lib/reports/carregarVendasPeriodo';
import { analisarVendas, contasDoRecorte, opcoesDosFiltros, FILTROS_VAZIOS, type Analise, type ContaResumo, type FiltrosRelatorio, type Recorte } from '@/lib/reports/analiseVendas';
import { analisarEquipe, linhaDoTempo, type AtividadeEquipe, type FontesEquipe } from '@/lib/reports/analiseEquipe';
import { limitesDoDia } from '@/lib/reports/dia';
import type { SecaoRelatorio } from '@/lib/reports/relatorioCompletoHtml';
import { montarPainelDeVendas } from '@/lib/reports/painelDia';
import { buildFechamentoWorkbook } from '@/lib/reports/fechamentoXlsx';
import { baixarWorkbook } from '@/lib/reports/baixar';
import type { ExceptionsReport } from '@/lib/excecoes';
import type { Category, CategoryGroup, OperatorCheckin, Order } from '@/types';
import { ListaDetalhe } from './ListaDetalhe';
import { cardCls } from './graficos';
import { AbaVisaoGeral } from './AbaVisaoGeral';
import { AbaProdutos } from './AbaProdutos';
import { AbaContas } from './AbaContas';
import { AbaEquipe } from './AbaEquipe';
import { PessoaDetalhe } from './PessoaDetalhe';
import type { PropsAba } from './tipos';

const PRESETS: { value: PresetPeriodo; label: string }[] = [
  { value: 'hoje', label: 'Hoje' }, { value: 'ontem', label: 'Ontem' }, { value: '7d', label: '7 dias' }, { value: '30d', label: '30 dias' },
  { value: 'mes', label: 'Este mês' }, { value: 'mes_passado', label: 'Mês passado' }, { value: 'personalizado', label: 'Escolher datas' },
];
const selectCls = 'block w-full h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]';
const diaCurto = (d: string) => new Date(`${d}T12:00:00-03:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
type Aba = 'geral' | 'produtos' | 'equipe' | 'contas';
const ABAS: { value: Aba; label: string; icone: React.ReactNode }[] = [
  { value: 'geral', label: 'Visão geral', icone: <LayoutDashboard size={16} /> }, { value: 'produtos', label: 'Produtos', icone: <ShoppingBag size={16} /> },
  { value: 'equipe', label: 'Equipe', icone: <Users size={16} /> }, { value: 'contas', label: 'Contas', icone: <Receipt size={16} /> },
];

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
  const [aba, setAba] = useState<Aba>('geral');
  const [lista, setLista] = useState<{ titulo: string; contas: ContaResumo[] } | null>(null);
  const [gerando, setGerando] = useState(false);
  // Equipe: atividade do app (189), exceções e ponto do período.
  const [atividade, setAtividade] = useState<AtividadeEquipe | null>(null);
  const [atividadeOk, setAtividadeOk] = useState<boolean | null>(null);
  const [excecoes, setExcecoes] = useState<ExceptionsReport | null>(null);
  const [checkins, setCheckins] = useState<OperatorCheckin[]>([]);
  const [carregandoEquipe, setCarregandoEquipe] = useState(false);
  const [pessoaAberta, setPessoaAberta] = useState<string | null>(null);
  const pedido = useRef(0);
  const pedidoEquipe = useRef(0);
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

  useEffect(() => {
    if (!periodo.de || !periodo.ate || periodo.ate < periodo.de) return;
    const meu = ++pedidoEquipe.current;
    const [ini] = limitesDoDia(periodo.de); const [, fim] = limitesDoDia(periodo.ate);
    setCarregandoEquipe(true);
    Promise.all([
      fetchAtividadeEquipe(storeId, ini, fim),
      fetchExceptionsReport(storeId, ini, fim).catch(() => null),
      fetchCheckinsHistory(storeId, ini.toISOString(), fim.toISOString()).catch(() => []),
    ]).then(([a, e, c]) => {
      if (meu !== pedidoEquipe.current) return;
      setAtividade(a); setAtividadeOk(a != null); setExcecoes(e); setCheckins(c);
    }).finally(() => { if (meu === pedidoEquipe.current) setCarregandoEquipe(false); });
  }, [storeId, periodo.de, periodo.ate]);

  const analise: Analise = useMemo(() => analisarVendas(vendas, categorias, filtros, cfgTaxa), [vendas, categorias, filtros, cfgTaxa]);
  const analiseAnt = useMemo(() => (anteriores ? analisarVendas(anteriores, categorias, filtros, cfgTaxa) : null), [anteriores, categorias, filtros, cfgTaxa]);
  const opcoes = useMemo(() => opcoesDosFiltros(vendas), [vendas]);
  const opcoesCategoria = useMemo(() => opcoesDoFiltro(categorias as never, grupos as never), [categorias, grupos]);
  const fontesEquipe: FontesEquipe = useMemo(() => {
    const fimPeriodo = new Date(Math.min(limitesDoDia(periodo.ate)[1].getTime(), Date.now())).toISOString();
    return { vendas, categorias, atividade, excecoes, checkins, fimPeriodo };
  }, [vendas, categorias, atividade, excecoes, checkins, periodo.ate]);
  const equipe = useMemo(() => analisarEquipe(fontesEquipe), [fontesEquipe]);
  const pessoa = pessoaAberta ? equipe.pessoas.find((p) => p.nome === pessoaAberta) ?? null : null;
  const linhaPessoa = useMemo(() => (pessoa ? linhaDoTempo(pessoa.nome, fontesEquipe) : []), [pessoa, fontesEquipe]);

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
  const avisoJanela = () => toast.error('Não consegui abrir a impressão. Confira o bloqueador de janelas.');
  const pdf = async (secoes?: SecaoRelatorio[], titulo?: string) => {
    const ok = await printRelatorioCompleto(analise, meta(titulo), secoes).catch(() => false);
    if (!ok) avisoJanela();
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
  const topo = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const propsAba: PropsAba = {
    analise, analiseAnt, periodo, umDia: periodo.de === periodo.ate, carregando, abrirLista, pdf,
    irParaDia: (dia) => { setPreset('personalizado'); setDe(dia); setAte(dia); topo(); },
    irParaPessoa: (nome) => { setAba('equipe'); setPessoaAberta(equipe.pessoas.some((p) => p.nome === nome) ? nome : equipe.pessoas.find((p) => p.nome.startsWith(nome))?.nome ?? null); },
    filtrarCategoria: (id) => { setValorCategoria(`c:${id}`); setFiltros((f) => ({ ...f, categoria: { tipo: 'categoria', id } })); topo(); },
  };

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

      <div role="tablist" aria-label="Partes do relatório" className="flex max-sm:grid max-sm:grid-cols-4 gap-1 p-1 rounded-full max-sm:rounded-[18px] bg-[var(--surface-2)] max-w-full w-fit max-sm:w-full">
        {ABAS.map((a) => (
          <button key={a.value} type="button" role="tab" aria-selected={aba === a.value} onClick={() => setAba(a.value)}
            className={`shrink-0 min-h-10 px-4 max-sm:px-1 max-sm:py-1.5 rounded-full max-sm:rounded-[14px] text-[14px] max-sm:text-[12px] font-semibold flex max-sm:flex-col items-center justify-center gap-2 max-sm:gap-0.5 u-motion u-press-sm ${aba === a.value ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
            {a.icone}{a.label}{a.value === 'equipe' && equipe.pessoas.length > 0 && <span className="text-[12px] num opacity-70 max-sm:hidden">{equipe.pessoas.length}</span>}
          </button>
        ))}
      </div>

      <div className={carregando ? 'opacity-60 pointer-events-none u-motion' : 'u-motion'}>
        {aba === 'geral' && <AbaVisaoGeral {...propsAba} />}
        {aba === 'produtos' && <AbaProdutos {...propsAba} />}
        {aba === 'equipe' && (
          <AbaEquipe pessoas={equipe.pessoas} aparelhos={equipe.aparelhos} atividadeOk={atividadeOk} cortado={!!atividade?.cortado} carregandoAtividade={carregandoEquipe}
            abrirPessoa={setPessoaAberta} pdfEquipe={async () => { const ok = await printEquipe(equipe.pessoas, meta('Equipe')).catch(() => false); if (!ok) avisoJanela(); }} />
        )}
        {aba === 'contas' && <AbaContas {...propsAba} />}
      </div>

      <ListaDetalhe titulo={lista?.titulo ?? null} contas={lista?.contas ?? []} meta={meta(lista?.titulo)} onClose={() => setLista(null)} />
      <PessoaDetalhe key={pessoa?.nome ?? 'nenhuma'} pessoa={pessoa} indice={pessoa ? equipe.pessoas.indexOf(pessoa) : 0} linha={linhaPessoa} periodoLabel={rotuloDoPeriodo(periodo.de, periodo.ate)}
        onClose={() => setPessoaAberta(null)}
        verContas={(nome) => { setPessoaAberta(null); abrirLista(`Itens lançados por ${nome}`, { pessoa: nome }); }}
        pdf={async (p, l) => { const ok = await printPessoa(p, l, meta(p.nome)).catch(() => false); if (!ok) avisoJanela(); }} />
    </div>
  );
};
