// Relatório completo (25/10/2026, pedido do dono: "ver tudo, por categoria, clicar e ver todas as listas, PDF de tudo").
// Toda a conta do painel de Relatórios fica aqui, pura e testada; a tela só desenha.
// - Venda = conta paga (agruparPorConta); valor = valorFaturado (sem cortesia).
// - Filtro de categoria ou de quem lançou age nos ITENS: aí os totais são a soma dos itens filtrados (sem taxa).
// - Item cancelado e taxa (fee_type) não são produto vendido; cancelados aparecem só em kpis.cancelados.
import type { Order } from '@/types';
import { CORTESIA, chaveContaPaga, cortesiaDaVenda, decomporVenda, metodosDoPagamento, valorFaturado, type ConfigTaxa } from '../faturamento';
import { getOrderItemDisplayName, getPaymentMethodLabel } from '../labels';
import type { FiltroCategoria } from '../rankingProdutos';

export type FiltrosRelatorio = { categoria: FiltroCategoria; operador: string | null; forma: string | null; tipo: 'todos' | 'mesa' | 'balcao' };
export const FILTROS_VAZIOS: FiltrosRelatorio = { categoria: { tipo: 'todas' }, operador: null, forma: null, tipo: 'todos' };
export type CategoriaRel = { id: string; name: string; group_id?: string | null };

export type LinhaProduto = { chave: string; nome: string; categoriaId: string; categoria: string; qtd: number; total: number; contas: number };
export type ContaResumo = { id: string; quando: string; local: string; operador: string; formas: string; total: number; itens: { nome: string; qtd: number; total: number }[] };
export type Analise = {
  modoItens: boolean;
  kpis: { faturamento: number; contas: number; ticket: number; itens: number; taxaServico: number; cortesia: number; cancelados: { qtd: number; valor: number }; mesasAtendidas: number; maiorConta: number; horaPico: number | null; diaPico: string | null };
  porDia: { dia: string; total: number; contas: number; ticket: number }[];
  /** 7 × 24: total vendido por dia da semana (0 = domingo) e hora, fuso da Bahia. */
  mapaCalor: number[][];
  porTipo: { mesa: { total: number; contas: number }; balcao: { total: number; contas: number } };
  porHora: { hora: number; total: number; contas: number }[];
  porDiaSemana: { dia: number; total: number; contas: number }[];
  produtos: LinhaProduto[];
  categorias: { id: string; nome: string; qtd: number; total: number; pct: number }[];
  formas: { chave: string; rotulo: string; total: number; contas: number }[];
  equipe: { nome: string; itens: number; total: number; contas: number }[];
  mesas: { rotulo: string; contas: number; total: number; ticket: number }[];
  contas: ContaResumo[];
};

type Item = NonNullable<Order['order_items']>[number] & { added_by_role?: string | null; added_by_name?: string | null };
type Pd = { operador_nome?: string } | null;
const SEM_CATEGORIA = '_sem';
const arred = (n: number) => Math.round(n * 100) / 100;
export const partesBahia = (iso: string) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return { dia: `${g('year')}-${g('month')}-${g('day')}`, hora: Number(g('hour')) % 24, dow };
};
const assinatura = (i: Item) => (i.selected_options || []).map((o) => o.name).slice().sort().join('|');
export const chaveDoProduto = (i: Item) => `${i.product_id ?? i.product?.name ?? '?'}::${assinatura(i)}`;
export const ehProduto = (i: Item) => i.status !== ('canceled' as never) && !i.product?.fee_type;
export const localDa = (o: Order) => (o.order_type === 'counter' ? 'Balcão' : `Mesa ${(o as { tables?: { number?: number | string } }).tables?.number ?? '?'}`);
const operadorDa = (o: Order) => ((o.payment_details as Pd)?.operador_nome || 'Equipe').trim();
export const quemLancou = (i: Item, o: Order) => (i.added_by_role === 'cliente' ? 'Cliente pelo QR' : (i.added_by_name || operadorDa(o)).trim());
const formasDa = (o: Order) => (metodosDoPagamento(o) ?? []).filter((m) => m.method && m.method !== CORTESIA).map((m) => m.method as string);

function filtraCategoria(categorias: CategoriaRel[], f: FiltroCategoria) {
  if (f.tipo === 'todas') return () => true;
  const doGrupo = f.tipo === 'grupo' ? new Set(categorias.filter((c) => c.group_id === f.id).map((c) => c.id)) : null;
  return (cid: string | null | undefined) => !!cid && (f.tipo === 'categoria' ? cid === f.id : doGrupo!.has(cid));
}

/** Contas que passam pelos filtros de conta (tipo e forma) e os itens que passam pelos filtros de item. */
function aplicar(vendas: Order[], categorias: CategoriaRel[], f: FiltrosRelatorio) {
  const catOk = filtraCategoria(categorias, f.categoria);
  const modoItens = f.categoria.tipo !== 'todas' || !!f.operador;
  const out: { o: Order; itens: Item[]; cancelados: Item[]; valor: number }[] = [];
  for (const o of vendas) {
    if (o.status === 'canceled') continue;
    if (f.tipo === 'mesa' && o.order_type === 'counter') continue;
    if (f.tipo === 'balcao' && o.order_type !== 'counter') continue;
    if (f.forma && !formasDa(o).includes(f.forma)) continue;
    const todos = (o.order_items ?? []) as Item[];
    const passa = (i: Item) => catOk(i.product?.category_id) && (!f.operador || quemLancou(i, o) === f.operador);
    const itens = todos.filter((i) => ehProduto(i) && passa(i));
    const cancelados = todos.filter((i) => i.status === ('canceled' as never) && !i.product?.fee_type && passa(i));
    // Conta sem nada pago (100% cortesia ou zerada) não é venda em nenhum modo.
    const pago = valorFaturado(o);
    const valor = pago <= 0 ? 0 : modoItens ? arred(itens.reduce((s, i) => s + Number(i.price_at_time) * i.quantity, 0)) : pago;
    if (modoItens ? itens.length === 0 && cancelados.length === 0 : valor <= 0 && cancelados.length === 0) continue;
    out.push({ o, itens, cancelados, valor });
  }
  return { linhas: out, modoItens };
}

export function resumoDaConta(o: Order, itens?: Item[], valor?: number): ContaResumo {
  const lista = (itens ?? ((o.order_items ?? []) as Item[]).filter(ehProduto));
  return {
    id: o.id,
    quando: o.created_at,
    local: localDa(o),
    operador: operadorDa(o),
    formas: [...new Set(formasDa(o))].map((m) => getPaymentMethodLabel(m)).join(', ') || (cortesiaDaVenda(o) > 0 ? 'Cortesia' : '—'),
    total: valor ?? valorFaturado(o),
    // Mesmo item lançado várias vezes vira uma linha só (4x Itaipava, não 4 linhas de 1x).
    itens: [...lista.reduce((m, i) => {
      const nome = getOrderItemDisplayName(i); const preco = Number(i.price_at_time);
      const k = `${nome}§${preco}`; const c = m.get(k) ?? { nome, qtd: 0, total: 0 };
      c.qtd += i.quantity; c.total = arred(c.total + preco * i.quantity); m.set(k, c); return m;
    }, new Map<string, { nome: string; qtd: number; total: number }>()).values()],
  };
}

export function analisarVendas(vendas: Order[], categorias: CategoriaRel[], f: FiltrosRelatorio = FILTROS_VAZIOS, cfgTaxa?: ConfigTaxa): Analise {
  const { linhas, modoItens } = aplicar(vendas, categorias, f);
  const nomeCat = new Map(categorias.map((c) => [c.id, c.name]));
  const contasVendidas = linhas.filter((l) => l.valor > 0);
  const k: Analise['kpis'] = { faturamento: 0, contas: 0, ticket: 0, itens: 0, taxaServico: 0, cortesia: 0, cancelados: { qtd: 0, valor: 0 }, mesasAtendidas: 0, maiorConta: 0, horaPico: null, diaPico: null };
  const mapaCalor = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  const porTipo = { mesa: { total: 0, contas: 0 }, balcao: { total: 0, contas: 0 } };
  const dias = new Map<string, { total: number; contas: number }>();
  const horas = new Map<number, { total: number; contas: number }>();
  const semana = new Map<number, { total: number; contas: number }>();
  const prods = new Map<string, LinhaProduto & { _contas: Set<string> }>();
  const formas = new Map<string, { total: number; contas: number }>();
  const equipe = new Map<string, { itens: number; total: number; _contas: Set<string> }>();
  const mesas = new Map<string, { contas: number; total: number }>();
  const soma = <K,>(m: Map<K, { total: number; contas: number }>, key: K, v: number) => { const c = m.get(key) ?? { total: 0, contas: 0 }; c.total += v; c.contas += 1; m.set(key, c); };

  for (const l of linhas) {
    for (const i of l.cancelados) { k.cancelados.qtd += i.quantity; k.cancelados.valor += Number(i.price_at_time) * i.quantity; }
    if (l.valor <= 0) continue;
    const { o } = l;
    k.faturamento += l.valor;
    k.contas += 1;
    if (!modoItens) { k.taxaServico += decomporVenda(o, cfgTaxa).taxa; k.cortesia += cortesiaDaVenda(o); }
    const t = partesBahia(o.created_at);
    soma(dias, t.dia, l.valor); soma(horas, t.hora, l.valor); soma(semana, t.dow, l.valor);
    soma(mesas, localDa(o), l.valor);
    mapaCalor[t.dow][t.hora] += l.valor;
    const tp = o.order_type === 'counter' ? porTipo.balcao : porTipo.mesa; tp.total += l.valor; tp.contas += 1;
    if (l.valor > k.maiorConta) k.maiorConta = l.valor;
    const conta = chaveContaPaga(o);
    for (const m of metodosDoPagamento(o) ?? []) {
      if (!m.method || m.method === CORTESIA) continue;
      const c = formas.get(m.method) ?? { total: 0, contas: 0 }; c.total += Number(m.amount) || 0; formas.set(m.method, c);
    }
    for (const fm of new Set(formasDa(o))) { const c = formas.get(fm)!; c.contas += 1; }
    for (const i of l.itens) {
      const v = Number(i.price_at_time) * i.quantity;
      k.itens += i.quantity;
      const ch = chaveDoProduto(i);
      const cid = i.product?.category_id || SEM_CATEGORIA;
      const p = prods.get(ch) ?? { chave: ch, nome: getOrderItemDisplayName(i), categoriaId: cid, categoria: nomeCat.get(cid) ?? 'Sem categoria', qtd: 0, total: 0, contas: 0, _contas: new Set<string>() };
      p.qtd += i.quantity; p.total += v; p._contas.add(conta); prods.set(ch, p);
      const quem = quemLancou(i, o);
      const e = equipe.get(quem) ?? { itens: 0, total: 0, _contas: new Set<string>() };
      e.itens += i.quantity; e.total += v; e._contas.add(conta); equipe.set(quem, e);
    }
  }
  k.faturamento = arred(k.faturamento); k.taxaServico = arred(k.taxaServico); k.cortesia = arred(k.cortesia);
  k.cancelados.valor = arred(k.cancelados.valor);
  k.ticket = k.contas ? arred(k.faturamento / k.contas) : 0;
  k.maiorConta = arred(k.maiorConta);
  k.mesasAtendidas = [...mesas.keys()].filter((r) => r !== 'Balcão').length;
  const pico = <K,>(m: Map<K, { total: number }>) => { let best: K | null = null; let v = -1; for (const [key, x] of m) if (x.total > v) { v = x.total; best = key; } return best; };
  k.horaPico = pico(horas); k.diaPico = pico(dias);
  porTipo.mesa.total = arred(porTipo.mesa.total); porTipo.balcao.total = arred(porTipo.balcao.total);

  const produtos = [...prods.values()].map(({ _contas, ...p }) => ({ ...p, total: arred(p.total), contas: _contas.size }))
    .sort((a, b) => b.qtd - a.qtd || b.total - a.total || a.nome.localeCompare(b.nome));
  const somaProd = produtos.reduce((s, p) => s + p.total, 0);
  const cats = new Map<string, { id: string; nome: string; qtd: number; total: number }>();
  for (const p of produtos) { const c = cats.get(p.categoriaId) ?? { id: p.categoriaId, nome: p.categoria, qtd: 0, total: 0 }; c.qtd += p.qtd; c.total += p.total; cats.set(p.categoriaId, c); }

  return {
    modoItens,
    kpis: k,
    porDia: [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, v]) => ({ dia, total: arred(v.total), contas: v.contas, ticket: arred(v.total / v.contas) })),
    mapaCalor: mapaCalor.map((h) => h.map(arred)),
    porTipo,
    porHora: [...horas.entries()].sort(([a], [b]) => a - b).map(([hora, v]) => ({ hora, total: arred(v.total), contas: v.contas })),
    porDiaSemana: [...semana.entries()].sort(([a], [b]) => a - b).map(([dia, v]) => ({ dia, total: arred(v.total), contas: v.contas })),
    produtos,
    categorias: [...cats.values()].map((c) => ({ ...c, total: arred(c.total), pct: somaProd ? arred((c.total / somaProd) * 100) : 0 })).sort((a, b) => b.total - a.total),
    formas: [...formas.entries()].map(([chave, v]) => ({ chave, rotulo: getPaymentMethodLabel(chave), total: arred(v.total), contas: v.contas })).sort((a, b) => b.total - a.total),
    equipe: [...equipe.entries()].map(([nome, v]) => ({ nome, itens: v.itens, total: arred(v.total), contas: v._contas.size })).sort((a, b) => b.total - a.total),
    mesas: [...mesas.entries()].map(([rotulo, v]) => ({ rotulo, contas: v.contas, total: arred(v.total), ticket: arred(v.total / v.contas) })).sort((a, b) => b.total - a.total),
    contas: contasVendidas.map((l) => resumoDaConta(l.o, l.itens, l.valor)).sort((a, b) => b.quando.localeCompare(a.quando)),
  };
}

/** Contas para o clique numa linha do painel (mesmos filtros + o recorte clicado). */
export type Recorte = { produto?: string; categoria?: string; forma?: string; pessoa?: string; local?: string; dia?: string; hora?: number; diaSemana?: number };
export function contasDoRecorte(vendas: Order[], categorias: CategoriaRel[], f: FiltrosRelatorio, r: Recorte): ContaResumo[] {
  const { linhas, modoItens } = aplicar(vendas, categorias, f);
  const out: ContaResumo[] = [];
  for (const l of linhas) {
    if (l.valor <= 0) continue;
    const { o } = l;
    const t = partesBahia(o.created_at);
    if (r.dia && t.dia !== r.dia) continue;
    if (r.hora != null && t.hora !== r.hora) continue;
    if (r.diaSemana != null && t.dow !== r.diaSemana) continue;
    if (r.local && localDa(o) !== r.local) continue;
    if (r.forma && !formasDa(o).includes(r.forma)) continue;
    let itens = l.itens;
    if (r.produto) itens = itens.filter((i) => chaveDoProduto(i) === r.produto);
    if (r.categoria) itens = itens.filter((i) => (i.product?.category_id || SEM_CATEGORIA) === r.categoria);
    if (r.pessoa) itens = itens.filter((i) => quemLancou(i, o) === r.pessoa);
    const porItem = !!(r.produto || r.categoria || r.pessoa);
    if (porItem && itens.length === 0) continue;
    const valor = porItem ? arred(itens.reduce((s, i) => s + Number(i.price_at_time) * i.quantity, 0)) : (modoItens ? l.valor : valorFaturado(o));
    out.push(resumoDaConta(o, itens, valor));
  }
  return out.sort((a, b) => b.quando.localeCompare(a.quando));
}

/** Opções dos filtros (quem lançou e formas) a partir das vendas carregadas. */
export function opcoesDosFiltros(vendas: Order[]): { pessoas: string[]; formas: { chave: string; rotulo: string }[] } {
  const pessoas = new Set<string>(); const fs = new Set<string>();
  for (const o of vendas) {
    for (const i of (o.order_items ?? []) as Item[]) if (ehProduto(i)) pessoas.add(quemLancou(i, o));
    for (const m of formasDa(o)) fs.add(m);
  }
  return { pessoas: [...pessoas].sort((a, b) => a.localeCompare(b)), formas: [...fs].map((chave) => ({ chave, rotulo: getPaymentMethodLabel(chave) })).sort((a, b) => a.rotulo.localeCompare(b.rotulo)) };
}

/** Período atual × anterior no mesmo gráfico, alinhados pela posição (1º dia com 1º dia). */
export function serieComparada(atual: { dia: string; total: number }[], anterior: { dia: string; total: number }[]): { rotulo: string; atual: number; anterior: number | null }[] {
  return atual.map((d, i) => ({ rotulo: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`, atual: d.total, anterior: anterior[i]?.total ?? null }));
}
