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
type ItemLike = {
  quantity: number;
  price_at_time: number;
  status?: string;
  product?: ProdutoLike;
  product_id?: string;
  /** migration 141: valor da taxa digitado pelo caixa (não é mais o % do produto). */
  fee_manual?: boolean | null;
  /** migration 141: percentual digitado (null = digitou o valor em R$). */
  fee_manual_percent?: number | null;
};

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

// Taxa editável (migration 141, pedido do Ramon 2026-10-01): o caixa digita o VALOR em R$ ou o
// PERCENTUAL e o item grava exatamente isso. Mesmas regras do servidor (add_fee_item_secure):
// - valor: 0 <= valor <= total da conta (sem taxas); percentual: 0 a 100;
// - valor 0 = "sem taxa de serviço" (tira o item, como o "Tirar a taxa");
// - taxa fixa (rolha...): valor > 0 e <= TETO_VALOR_TAXA_FIXA, nunca percentual.
export const TETO_PERCENT_TAXA = 100;
export const TETO_VALOR_TAXA_FIXA = 5000;

// meio centavo sobe, como o round() do Postgres (o epsilon cobre o erro de ponto flutuante: 12.855 -> 12.86)
const arred2 = (n: number) => Math.round(n * 100 + 1e-6) / 100;

export type ResultadoTaxaEditada =
  | { ok: true; valor: number; percent: number | null; semTaxa: boolean }
  | { ok: false; message: string };

/** Valida/calcula a taxa de serviço digitada. `base` = baseDaTaxaPercentual(itens). */
export function resolverTaxaEditada(base: number, ed: { valor?: number | null; percent?: number | null }): ResultadoTaxaEditada {
  const temValor = ed.valor !== null && ed.valor !== undefined && !Number.isNaN(ed.valor);
  const temPercent = ed.percent !== null && ed.percent !== undefined && !Number.isNaN(ed.percent);
  if (temValor === temPercent) return { ok: false, message: 'Informe o valor OU o percentual da taxa.' };
  const b = arred2(base);
  if (temValor) {
    const v = arred2(ed.valor as number);
    if (v < 0) return { ok: false, message: 'Valor da taxa não pode ser negativo.' };
    if (v > b) return { ok: false, message: `A taxa não pode ser maior que o total da conta (R$ ${b.toFixed(2).replace('.', ',')}).` };
    return { ok: true, valor: v, percent: null, semTaxa: v === 0 };
  }
  const p = ed.percent as number;
  if (p < 0 || p > TETO_PERCENT_TAXA) return { ok: false, message: `Percentual da taxa deve ficar entre 0 e ${TETO_PERCENT_TAXA}.` };
  const v = arred2((b * p) / 100);
  return { ok: true, valor: v, percent: p, semTaxa: v === 0 };
}

/** Taxa fixa com preço diferente do cadastrado (rolha cobrada diferente). */
export function resolverValorTaxaFixa(valor: number): ResultadoTaxaEditada {
  if (Number.isNaN(valor) || valor <= 0 || valor > TETO_VALOR_TAXA_FIXA) {
    return { ok: false, message: 'Valor da taxa deve ficar entre R$ 0,01 e R$ 5.000,00.' };
  }
  return { ok: true, valor: arred2(valor), percent: null, semTaxa: false };
}

/**
 * A taxa percentual lançada ficou desatualizada porque entrou/saiu item da conta?
 * - item editado em R$: nunca recalcula (valor digitado manda);
 * - item editado em %: recalcula com o percentual digitado;
 * - item padrão: recalcula com o percentual do produto.
 */
export function taxaPercentualDesatualizada(itens: ItemLike[]): { item: ItemLike; esperado: number } | null {
  const item = ativos(itens).find((i) => ehTaxaPercentual(i.product));
  if (!item) return null;
  if (item.fee_manual && item.fee_manual_percent == null) return null;
  const pct = item.fee_manual ? Number(item.fee_manual_percent) : Number(item.product?.fee_percent);
  if (!pct) return null;
  const esperado = valorTaxaPercentual(itens, pct);
  return Math.abs(item.price_at_time - esperado) < 0.01 ? null : { item, esperado };
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
