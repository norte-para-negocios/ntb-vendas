// Faturamento de uma venda (conta paga), igual ao fechamento do turno no banco (migration 173).
// Regras (pedido do Joaquim, 08/10, achadas nos dados reais do Sertão):
// - o valor da venda é o que foi PAGO (soma das formas), não payment_details.total (em várias contas ele não inclui os 10%)
//   nem orders.total (não desconta item cancelado);
// - CORTESIA não é faturamento: sai do valor e aparece à parte;
// - conta fechada em zero (tudo cancelado) vale 0 e não conta como conta paga;
// - pedidos da mesma conta (ex.: pedido da taxa lançada pelo caixa) somam UMA vez.
// Cada conta fecha exatamente: itens - desconto + taxa de serviço + outras taxas + pago a mais - cortesia = recebido.

import { resolveServiceFeeRate } from './calc';

export const CORTESIA = 'COURTESY';

type Metodo = { method?: string; amount?: number | string; brand?: string | null };
type Pd = { payment_id?: string; total?: number; methods?: Metodo[]; operador_id?: string; cash_shift_id?: string } | null | undefined;
type ItemLike = { quantity: number; price_at_time: number | string; status?: string; product?: { fee_type?: string | null } | null };
export type VendaLike = {
  id: string;
  table_id?: string | null;
  status?: string;
  coupon_discount?: number | string | null;
  payment_details?: Pd | Record<string, unknown> | null;
  order_items?: ItemLike[] | null;
};

const arred = (n: number) => Math.round(n * 100 + (n >= 0 ? 1e-6 : -1e-6)) / 100;
const pdDe = (o: VendaLike) => (o.payment_details ?? null) as Pd;

/** Formas de pagamento gravadas, ou null em venda antiga sem esse registro. */
export function metodosDoPagamento(o: VendaLike): Metodo[] | null {
  const m = pdDe(o)?.methods;
  return Array.isArray(m) ? m : null;
}

const somaMetodos = (ms: Metodo[], filtro: (m: Metodo) => boolean) => ms.filter(filtro).reduce((s, m) => s + (Number(m.amount) || 0), 0);

const ativos = (o: VendaLike) => (o.order_items ?? []).filter((i) => i.status !== 'canceled');
const somaItens = (itens: ItemLike[]) => itens.reduce((s, i) => s + Number(i.price_at_time) * i.quantity, 0);

/** Cortesia registrada no pagamento da venda. */
export function cortesiaDaVenda(o: VendaLike): number {
  const ms = metodosDoPagamento(o);
  return ms ? arred(somaMetodos(ms, (m) => m.method === CORTESIA)) : 0;
}

/** Valor faturado da venda: o que foi pago, sem cortesia. Venda antiga sem formas gravadas: total gravado ou itens. */
export function valorFaturado(o: VendaLike): number {
  const ms = metodosDoPagamento(o);
  if (ms) return arred(somaMetodos(ms, (m) => m.method !== CORTESIA));
  const t = pdDe(o)?.total;
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  return arred(somaItens(ativos(o)));
}

/** Mesma chave do banco (_chave_conta_paga): payment_id, senão mesa + formas + total + operador + turno. */
export function chaveContaPaga(o: VendaLike): string {
  const pd = pdDe(o);
  if (pd?.payment_id) return pd.payment_id;
  if (!pd || !Array.isArray(pd.methods)) return `pedido|${o.id}`;
  return `${o.table_id ?? o.id}|${JSON.stringify(pd.methods)}|${pd.total ?? ''}|${pd.operador_id ?? ''}|${pd.cash_shift_id ?? ''}`;
}

/**
 * Junta os pedidos da mesma conta numa venda só (itens somados). A venda fica com o id do pedido principal
 * (o que tem mais itens que não são taxa; empate: o mais antigo da lista), então reimprimir/detalhar segue funcionando.
 */
export function agruparPorConta<T extends VendaLike>(vendas: T[]): T[] {
  const grupos = new Map<string, T[]>();
  const ordem: string[] = [];
  for (const v of vendas) {
    const k = chaveContaPaga(v);
    const g = grupos.get(k);
    if (g) g.push(v); else { grupos.set(k, [v]); ordem.push(k); }
  }
  return ordem.map((k) => {
    const g = grupos.get(k)!;
    if (g.length === 1) return g[0];
    const qtdProdutos = (v: T) => ativos(v).filter((i) => !i.product?.fee_type).length;
    const principal = g.reduce((a, b) => (qtdProdutos(b) > qtdProdutos(a) ? b : a));
    const desconto = g.reduce((s, v) => s + (Number(v.coupon_discount) || 0), 0);
    return {
      ...principal,
      coupon_discount: desconto || principal.coupon_discount,
      order_items: [principal, ...g.filter((v) => v !== principal)].flatMap((v) => v.order_items ?? []),
      pedidos_da_conta: g.map((v) => v.id),
    } as T;
  });
}

export type ConfigTaxa = { cobraTaxa: boolean; percentual: number };

export type Decomposicao = {
  itens: number; desconto: number; taxa: number; outras: number; excesso: number; cortesia: number; recebido: number; bruto: number;
};

/**
 * Decompõe UMA conta (já agrupada). Taxa de serviço = taxa lançada como item + o que foi pago acima dos itens, até o
 * percentual da loja; o que passar disso é "pago a mais". Conta 100% cortesia não tem taxa.
 */
export function decomporVenda(o: VendaLike, cfg: ConfigTaxa = { cobraTaxa: true, percentual: 0.1 }): Decomposicao {
  const its = ativos(o);
  const itens = arred(somaItens(its.filter((i) => !i.product?.fee_type)));
  const taxaItem = arred(somaItens(its.filter((i) => i.product?.fee_type === 'percent')));
  const outras = arred(somaItens(its.filter((i) => i.product?.fee_type === 'fixed')));
  const desconto = arred(Number(o.coupon_discount) || 0);
  const ms = metodosDoPagamento(o);
  const bruto = ms ? arred(somaMetodos(ms, () => true)) : valorFaturado(o);
  const recebido = ms ? arred(somaMetodos(ms, (m) => m.method !== CORTESIA)) : bruto;
  const cortesia = arred(bruto - recebido);
  if (recebido <= 0) return { itens, desconto, taxa: 0, outras, excesso: 0, cortesia, recebido, bruto };
  const taxaAuto = Math.max(arred(bruto - (itens - desconto) - taxaItem - outras), 0);
  const teto = arred(Math.max(itens - desconto, 0) * cfg.percentual) + 0.01;
  const taxaAutoOk = cfg.cobraTaxa ? Math.min(taxaAuto, teto) : 0;
  return { itens, desconto, taxa: arred(taxaAutoOk + taxaItem), outras, excesso: Math.max(arred(taxaAuto - taxaAutoOk), 0), cortesia, recebido, bruto };
}

/** Configuração de taxa a partir de stores.config (liga/desliga + percentual via resolveServiceFeeRate). */
export function configTaxaDaLoja(config: { charge_service_fee?: boolean } & Parameters<typeof resolveServiceFeeRate>[0] | null | undefined): ConfigTaxa {
  return { cobraTaxa: !!config?.charge_service_fee, percentual: resolveServiceFeeRate(config) };
}
