// Taxas como produto (migration 138, pedido do dono/Ramon 2026-10-01).
//
// No Omie as taxas são produtos (família "TAXAS / DELIVERY": Taxa de Serviço,
// Taxa de Rolha, Taxa de Troca, Couvert, Taxa Frete...). Aqui elas viram
// produto do cardápio com `fee_type`, ligado ao `omie_codigo`, e entram na
// conta como item comum — por isso vão pra nota fiscal e pro Estoque/Omie pelo
// fluxo de sempre. Regras:
// - só o CAIXA lança (podeLancarTaxa + add_fee_item_secure no servidor);
//   nunca aparecem no cardápio do cliente nem no lançamento do garçom;
// - 'percent' (taxa de serviço) é calculada no servidor sobre os itens da
//   conta que não são taxa; quando a conta tem esse item, a taxa automática
//   de 10% (charge_service_fee) deixa de ser somada — o item É a taxa.

type ProdutoLike = { fee_type?: string | null; fee_percent?: number | null } | null | undefined;
type ItemLike = { quantity: number; price_at_time: number; status?: string; product?: ProdutoLike };

export function ehTaxa(produto: ProdutoLike): boolean {
  return !!produto?.fee_type;
}

export function ehTaxaPercentual(produto: ProdutoLike): boolean {
  return produto?.fee_type === 'percent';
}

/** Tira os produtos-taxa da lista (cardápio do cliente e lançamento do garçom). */
export function semTaxas<P extends ProdutoLike>(produtos: P[]): P[] {
  return produtos.filter((p) => !ehTaxa(p));
}

const ativos = <I extends ItemLike>(itens: I[]) => itens.filter((i) => i.status !== 'canceled');

/** A conta já tem a taxa de serviço lançada como item? Então o automático não soma. */
export function contaTemTaxaPercentual(itens: ItemLike[]): boolean {
  return ativos(itens).some((i) => ehTaxaPercentual(i.product));
}

/** Base da taxa percentual: itens não cancelados que não são taxa. */
export function baseDaTaxaPercentual(itens: ItemLike[]): number {
  return ativos(itens)
    .filter((i) => !ehTaxa(i.product))
    .reduce((s, i) => s + i.price_at_time * i.quantity, 0);
}

/** Valor que a taxa percentual teria agora (mesma conta do servidor: round 2 casas). */
export function valorTaxaPercentual(itens: ItemLike[], percent: number): number {
  return Math.round(baseDaTaxaPercentual(itens) * percent) / 100;
}

/**
 * Quem pode lançar taxa: dono, conta universal, ou quem tem a permissão de caixa.
 * Mais restrito que canFinalizeBill de propósito — "isso APENAS NO CAIXA": em loja
 * sem módulo Caixa, canFinalizeBill libera todo mundo, aqui não.
 */
export function podeLancarTaxa(user: { role: string; permissions?: { caixa?: boolean } }): boolean {
  if (user.role === 'owner' || user.role === 'universal') return true;
  if (user.role === 'open') return false;
  return user.permissions?.caixa === true;
}
