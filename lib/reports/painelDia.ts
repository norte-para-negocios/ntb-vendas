// lib/reports/painelDia.ts — análise do dia (pura, sem I/O): alimenta o Excel e o relatório impresso.
import type { FechamentoData } from './fechamentoXlsx';
import { groupSales, type GroupRow } from './groupSales';
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
}

export function montarPainel(d: FechamentoData, nomeCategoria: (id: string) => string | undefined = () => undefined): PainelDia {
  const formasTot: Record<string, number> = {};
  const cartoesTot: Record<string, number> = {};
  let contas = 0, recebido = 0, sangria = 0, suprimento = 0, taxa = 0;
  d.turnos.forEach((t) => {
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

  const ativas = d.vendas.filter((o) => o.status !== 'canceled');
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

  const porHora = groupSales(d.vendas, 'hour');
  const porCategoria = groupSales(d.vendas, 'category').map((r) => ({ ...r, label: r.key === '_sem' ? r.label : nomeCategoria(r.key) ?? r.label }));

  return {
    kpis: { contas, recebido, ticket: ticketMedio(recebido, contas), taxa, sangria, suprimento, itens, cancelamentos: d.excecoes.length, credito, debito },
    formas: completarFormas(formasTot),
    cartoes: completarCartoes(cartoesTot),
    porHora,
    porOperador: groupSales(d.vendas, 'operator'),
    porCategoria,
    topProdutos: Array.from(prod.values()).sort((a, b) => b.total - a.total).slice(0, 10),
    melhorHora: porHora.length ? porHora.reduce((m, r) => (r.total > m.total ? r : m)) : null,
  };
}
