// Fechamento de caixa: lista COMPLETA de meios e bandeiras (inclusive zeradas), na ordem da folha de papel
// do Sertão, e ticket médio. Pedido do Ramon (03/10): "separar tudo, aparecer todos os meios e cartões possíveis".
import { getCardTotalLabel, getPaymentMethodLabel } from './labels';

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
