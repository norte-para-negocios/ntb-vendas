// Fechamento de caixa: lista COMPLETA de meios e bandeiras (inclusive zeradas), na ordem da folha de papel
// do Sertão, e ticket médio. Pedido do Ramon (03/10): "separar tudo, aparecer todos os meios e cartões possíveis".
import { getCardBrandLabel, getCardTotalLabel, getPaymentMethodLabel } from './labels';
import type { CashShiftSummary } from './api';
import type { DetalheFechamento } from './print';

// Meios sempre listados (mesmo com zero); outros (ex.: cortesia) só aparecem se tiverem valor.
export const FORMAS_FIXAS = ['CASH', 'PIX', 'DEBIT', 'CREDIT'] as const;

export function completarFormas(totals: Record<string, number>): { key: string; label: string; total: number }[] {
  const out: { key: string; label: string; total: number }[] = FORMAS_FIXAS.map((k) => ({ key: k, label: getPaymentMethodLabel(k), total: Number(totals[k] ?? 0) }));
  Object.entries(totals).forEach(([k, v]) => {
    if (!(FORMAS_FIXAS as readonly string[]).includes(k) && Number(v) !== 0) out.push({ key: k, label: getPaymentMethodLabel(k), total: Number(v) });
  });
  return out;
}

// Ordem da folha: MASTERCARD, ELO CRÉDITO, AMEX, VISA CRÉDITO, HIPERCARD, ELECTRON (Visa débito),
// MAESTRO (Master débito), ELO DÉBITO, depois os tickets (Alelo, Sodexo, Ticket, VR), que somam crédito+débito.
const LINHAS_FIXAS: { id: string; keys: string[]; label: string }[] = [
  { id: 'mc', keys: ['CREDIT|mastercard'], label: getCardTotalLabel('CREDIT|mastercard') },
  { id: 'elo_c', keys: ['CREDIT|elo'], label: getCardTotalLabel('CREDIT|elo') },
  { id: 'amex', keys: ['CREDIT|amex'], label: getCardTotalLabel('CREDIT|amex') },
  { id: 'visa_c', keys: ['CREDIT|visa'], label: getCardTotalLabel('CREDIT|visa') },
  { id: 'hiper', keys: ['CREDIT|hipercard'], label: getCardTotalLabel('CREDIT|hipercard') },
  { id: 'electron', keys: ['DEBIT|visa'], label: getCardTotalLabel('DEBIT|visa') },
  { id: 'maestro', keys: ['DEBIT|mastercard'], label: getCardTotalLabel('DEBIT|mastercard') },
  { id: 'elo_d', keys: ['DEBIT|elo'], label: getCardTotalLabel('DEBIT|elo') },
  { id: 'alelo', keys: ['CREDIT|alelo', 'DEBIT|alelo'], label: getCardTotalLabel('CREDIT|alelo') },
  { id: 'sodexo', keys: ['CREDIT|sodexo', 'DEBIT|sodexo'], label: getCardTotalLabel('CREDIT|sodexo') },
  { id: 'ticket', keys: ['CREDIT|ticket', 'DEBIT|ticket'], label: getCardTotalLabel('CREDIT|ticket') },
  { id: 'vr', keys: ['CREDIT|vr', 'DEBIT|vr'], label: getCardTotalLabel('CREDIT|vr') },
];

export function completarCartoes(totalsByCard: Record<string, number>): { label: string; total: number }[] {
  const usados = new Set<string>();
  const out = LINHAS_FIXAS.map((l) => {
    l.keys.forEach((k) => usados.add(k));
    return { label: l.label, total: l.keys.reduce((s, k) => s + Number(totalsByCard[k] ?? 0), 0) };
  });
  // O que não está na folha (Cabal, Outra, cartão sem bandeira) entra no fim, só se tiver valor.
  Object.entries(totalsByCard)
    .filter(([k, v]) => !usados.has(k) && Number(v) !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([k, v]) => out.push({ label: getCardTotalLabel(k), total: Number(v) }));
  return out;
}

export function ticketMedio(total: number | null | undefined, contas: number | null | undefined): number | null {
  const t = Number(total ?? 0);
  const c = Number(contas ?? 0);
  return c > 0 ? Math.round((t / c) * 100) / 100 : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fechamento de caixa impresso/reimpresso a partir do resumo do turno (pedido do Joaquim 08/10: "relatório do caixa com
// botão de reimprimir, tudo extremamente destrinchado"). Uma função só para o fechamento, a reimpressão e os relatórios.

/** Formas de pagamento do turno SEM a cortesia (que não é faturamento e sai à parte). */
export function formasSemCortesia(totals: Record<string, number> | null | undefined) {
  return completarFormas(Object.fromEntries(Object.entries(totals ?? {}).filter(([k]) => k !== 'COURTESY')));
}

export function detalheDoResumo(r: CashShiftSummary): DetalheFechamento | null {
  if (r.items_total == null) return null; // banco sem a migration 173
  const n = (v: unknown) => Number(v) || 0;
  return {
    itens: n(r.items_total), qtdItens: n(r.items_count), desconto: n(r.discount_total), taxa: n(r.service_fee_total), taxaQtd: n(r.service_fee_count),
    outras: n(r.other_fees_total), excesso: n(r.overpaid_total), cortesiaParcial: n(r.courtesy_partial_total), faturado: n(r.payments_total),
    cortesia: { total: n(r.courtesy_total), contas: n(r.courtesy_count) },
    cancelados: { qtd: n(r.canceled_items_count), total: n(r.canceled_items_total) }, zeradas: n(r.zeroed_count),
    estornadas: { qtd: n(r.refunded_count), total: n(r.refunded_total) },
    funcionarios: { qtd: n(r.staff_count), total: n(r.staff_total) },
    movimentos: (r.movements ?? []).map((m) => ({ ...m, valor: n(m.valor) })),
    contas: (r.accounts ?? []).map((c) => ({ ...c, itens: n(c.itens), desconto: n(c.desconto), taxa: n(c.taxa), outras: n(c.outras), excesso: n(c.excesso), cortesia: n(c.cortesia), recebido: n(c.recebido), cancelado: n(c.cancelado), formas: c.formas ?? [] })),
    produtos: (r.products ?? []).map((p) => ({ ...p, quantidade: n(p.quantidade), total: n(p.total) })),
  };
}

export function dadosDoFechamento(r: CashShiftSummary, o: { storeName: string; operador: string; fechadoEm?: Date | null; contado?: number | null; diferenca?: number | null; reimpressoEm?: Date | null }) {
  const contado = o.contado !== undefined ? o.contado : r.closing_counted_cash;
  return {
    storeName: o.storeName,
    operador: o.operador,
    abertoEm: new Date(r.shift.opened_at),
    fechadoEm: o.fechadoEm ?? (r.shift.closed_at ? new Date(r.shift.closed_at) : new Date()),
    fundo: Number(r.shift.opening_float) || 0,
    formas: formasSemCortesia(r.totals_by_method).map(({ label, total }) => ({ label, total })),
    cartoes: r.totals_by_card
      ? completarCartoes(r.totals_by_card)
      : Object.entries(r.totals_by_brand ?? {}).map(([b, total]) => ({ label: getCardBrandLabel(b), total: Number(total) || 0 })),
    vendas: r.payments_count != null ? { contas: Number(r.payments_count) || 0, total: Number(r.payments_total) || 0, ticketMedio: ticketMedio(r.payments_total, r.payments_count) } : null,
    sangria: Number(r.total_sangria) || 0,
    suprimento: Number(r.total_suprimento) || 0,
    dinheiroEsperado: Number(r.expected_cash) || 0,
    dinheiroContado: contado ?? null,
    diferenca: o.diferenca !== undefined ? o.diferenca : (r.difference ?? (contado != null ? contado - (Number(r.expected_cash) || 0) : null)),
    taxaServico: r.service_fee_total != null ? { quantidade: Number(r.service_fee_count) || 0, total: Number(r.service_fee_total) || 0 } : null,
    outrasTaxas: Object.entries(r.fees_by_product ?? {})
      .filter(([, t]) => t.tipo === 'fixed')
      .map(([label, t]) => ({ label, quantidade: Number(t.quantidade) || 0, total: Number(t.total) || 0 })),
    detalhe: detalheDoResumo(r),
    reimpressoEm: o.reimpressoEm ?? null,
  };
}
