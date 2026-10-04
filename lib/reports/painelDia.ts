// lib/reports/painelDia.ts — análise do dia (pura, sem I/O): alimenta o Excel e o relatório impresso.
import type { Order } from '@/types';
import type { FechamentoData } from './fechamentoXlsx';
import { groupSales, type GroupRow } from './groupSales';
import { getOrderDisplayTotal } from '../calc';
import { salesOfShift } from './shiftSales';
import { completarFormas, completarCartoes, ticketMedio } from '../caixaResumo';

export interface TopProduto { nome: string; qtd: number; total: number }
export interface PainelDia {
  kpis: { contas: number; recebido: number; ticket: number | null; taxa: number; sangria: number; suprimento: number; itens: number; cancelamentos: number; credito: number; debito: number };
  formas: { key: string; label: string; total: number }[];
  cartoes: { label: string; total: number }[];
  porHora: GroupRow[];
  porOperador: GroupRow[];
  porCategoria: GroupRow[];
  topProdutos: TopProduto[];
  melhorHora: GroupRow | null;
  /** Rótulo do KPI de cancelamentos quando não é o padrão (no Histórico são vendas canceladas, não exceções do caixa). */
  rotuloCancelamentos?: string;
}

// Parte comum: tudo que sai direto das vendas (itens, hora, operador, categoria, produtos mais vendidos).
function analiseDeVendas(vendas: Order[], nomeCategoria: (id: string) => string | undefined) {
  const ativas = vendas.filter((o) => o.status !== 'canceled');
  const prod = new Map<string, TopProduto>();
  let itens = 0;
  ativas.forEach((o) => (o.order_items ?? []).filter((i) => i.status !== ('canceled' as never) && !i.product?.fee_type).forEach((i) => {
    const nome = i.product?.name ?? 'Produto';
    const cur = prod.get(nome) ?? { nome, qtd: 0, total: 0 };
    cur.qtd += i.quantity;
    cur.total += Number(i.price_at_time) * i.quantity;
    itens += i.quantity;
    prod.set(nome, cur);
  }));

  const porHora = groupSales(vendas, 'hour');
  // Categoria que não resolve pelo nome (apagada, ou a tela não passou o mapa) nunca aparece como id: soma em "Sem categoria".
  const cat = new Map<string, GroupRow>();
  groupSales(vendas, 'category').forEach((r) => {
    const nome = r.key === '_sem' ? undefined : nomeCategoria(r.key);
    const key = nome ? r.key : '_sem';
    const cur = cat.get(key);
    if (cur) cat.set(key, { ...cur, total: Math.round((cur.total + r.total) * 100) / 100 });
    else cat.set(key, { ...r, key, label: nome ?? 'Sem categoria' });
  });
  return {
    itens,
    porHora,
    porOperador: groupSales(vendas, 'operator'),
    porCategoria: Array.from(cat.values()).sort((a, b) => b.total - a.total),
    topProdutos: Array.from(prod.values()).sort((a, b) => b.total - a.total).slice(0, 10),
    melhorHora: porHora.length ? porHora.reduce((m, r) => (r.total > m.total ? r : m)) : null,
  };
}

export function montarPainel(d: FechamentoData, nomeCategoria: (id: string) => string | undefined = () => undefined): PainelDia {
  const formasTot: Record<string, number> = {};
  const cartoesTot: Record<string, number> = {};
  let contas = 0, recebido = 0, sangria = 0, suprimento = 0, taxa = 0;
  d.turnos.forEach((t) => {
    if (t.parcial && t.id) {
      // Turno que atravessa o período: só o que as vendas DO PERÍODO ligadas a ele pagaram (o resumo do turno cobre mais dias).
      const doTurno = salesOfShift(d.vendas, t.id);
      const pg = somarPagamentos(doTurno);
      Object.entries(pg.formas).forEach(([k, v]) => { formasTot[k] = (formasTot[k] ?? 0) + v; });
      Object.entries(pg.cartoes).forEach(([k, v]) => { cartoesTot[k] = (cartoesTot[k] ?? 0) + v; });
      contas += pg.contas; recebido += pg.recebido;
      // Taxa automática (total da conta − itens) ou taxa lançada como item (produto-taxa): uma OU outra por conta; o maior dos dois evita contar em dobro.
      const taxaItens = doTurno.filter((o) => o.status !== 'canceled').reduce((s2, o) => s2 + (o.order_items ?? []).filter((i) => i.product?.fee_type && i.status !== ('canceled' as never)).reduce((x, i) => x + Number(i.price_at_time) * i.quantity, 0), 0);
      taxa += Math.max(taxaItens, taxaDasVendas(doTurno));
      sangria += Number(t.resumo.total_sangria ?? 0);
      suprimento += Number(t.resumo.total_suprimento ?? 0);
      return;
    }
    Object.entries(t.resumo.totals_by_method ?? {}).forEach(([k, v]) => { formasTot[k] = (formasTot[k] ?? 0) + Number(v); });
    Object.entries(t.resumo.totals_by_card ?? {}).forEach(([k, v]) => { cartoesTot[k] = (cartoesTot[k] ?? 0) + Number(v); });
    contas += Number(t.resumo.payments_count ?? 0);
    recebido += Number(t.resumo.payments_total ?? 0);
    sangria += Number(t.resumo.total_sangria ?? 0);
    suprimento += Number(t.resumo.total_suprimento ?? 0);
    taxa += Number(t.resumo.service_fee_total ?? 0);
  });

  const credito = Object.entries(cartoesTot).filter(([k]) => k.startsWith('CREDIT|')).reduce((s, [, v]) => s + Number(v), 0);
  const debito = Object.entries(cartoesTot).filter(([k]) => k.startsWith('DEBIT|')).reduce((s, [, v]) => s + Number(v), 0);
  const { itens, ...analise } = analiseDeVendas(d.vendas, nomeCategoria);

  return {
    kpis: { contas, recebido, ticket: ticketMedio(recebido, contas), taxa, sangria, suprimento, itens, cancelamentos: d.excecoes.length, credito, debito },
    formas: completarFormas(formasTot),
    cartoes: completarCartoes(cartoesTot),
    ...analise,
  };
}

// Taxa de serviço cobrada: total da conta (payment_details.total) menos os itens, uma vez por conta (mesmo agrupamento de somarPagamentos).
function taxaDasVendas(vendas: Order[]): number {
  const contas = new Map<string, { total: number; itens: number }>();
  vendas.filter((o) => o.status !== 'canceled').forEach((o) => {
    const methods = (o.payment_details as Pd)?.methods;
    if (!Array.isArray(methods) || methods.length === 0) return;
    const chave = `${o.table_id ?? o.id}|${JSON.stringify(methods)}`;
    const itens = (o.order_items ?? []).filter((i) => i.status !== ('canceled' as never)).reduce((s, i) => s + Number(i.price_at_time) * i.quantity, 0);
    const cur = contas.get(chave);
    if (cur) cur.itens += itens; else contas.set(chave, { total: getOrderDisplayTotal(o as never), itens });
  });
  let taxa = 0;
  contas.forEach((c) => { const f = Math.round((c.total - c.itens) * 100) / 100; if (f > 0.005) taxa += f; });
  return Math.round(taxa * 100) / 100;
}

type Pd = { methods?: { method: string; brand?: string; amount: number }[] } | null;

// Painel a partir das próprias vendas (Histórico de vendas, com filtros): formas, cartões e contas saem de
// payment_details.methods, uma vez por conta (mesma regra de groupSales). Não há turno aqui, então taxa de
// serviço sai do total cobrado menos os itens; sangria e suprimento ficam em 0 (não existem nas vendas).
// Formas, cartões e contas pagas a partir das vendas (payment_details.methods, uma vez por conta).
function somarPagamentos(vendas: Order[]) {
  const formas: Record<string, number> = {};
  const cartoes: Record<string, number> = {};
  const vistas = new Set<string>();
  let contas = 0, recebido = 0;
  vendas.filter((o) => o.status !== 'canceled').forEach((o) => {
    const methods = (o.payment_details as Pd)?.methods;
    if (!Array.isArray(methods) || methods.length === 0) return;
    const conta = `${o.table_id ?? o.id}|${JSON.stringify(methods)}`;
    if (vistas.has(conta)) return;
    vistas.add(conta);
    contas += 1;
    methods.forEach((m) => {
      const v = Number(m.amount) || 0;
      recebido += v;
      formas[m.method] = (formas[m.method] ?? 0) + v;
      if (m.brand && (m.method === 'CREDIT' || m.method === 'DEBIT')) { const k = `${m.method}|${m.brand}`; cartoes[k] = (cartoes[k] ?? 0) + v; }
    });
  });
  return { formas, cartoes, contas, recebido };
}

export function montarPainelDeVendas(vendas: Order[], nomeCategoria: (id: string) => string | undefined = () => undefined): PainelDia {
  const { formas: formasTot, cartoes: cartoesTot, contas, recebido } = somarPagamentos(vendas);
  const soma = (pref: string) => Object.entries(cartoesTot).filter(([k]) => k.startsWith(pref)).reduce((s, [, v]) => s + v, 0);
  const { itens, ...analise } = analiseDeVendas(vendas, nomeCategoria);
  return {
    rotuloCancelamentos: 'Vendas canceladas',
    kpis: { contas, recebido, ticket: ticketMedio(recebido, contas), taxa: taxaDasVendas(vendas), sangria: 0, suprimento: 0, itens, cancelamentos: vendas.filter((o) => o.status === 'canceled').length, credito: soma('CREDIT|'), debito: soma('DEBIT|') },
    formas: completarFormas(formasTot),
    cartoes: completarCartoes(cartoesTot),
    ...analise,
  };
}
