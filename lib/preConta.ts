// Pré-conta ("nota antes da nota"): o extrato da mesa impresso quando pedem a conta, pro cliente conferir antes de
// pagar. Um lugar só pra montar — usado pelo botão Imprimir, pelo "Pedir conta" do garçom e pelo PC do caixa, que
// imprime sozinho quando qualquer mesa pede a conta (Ramon, 29/09: pediu pelo celular e não saiu).
import { calculateOrderTotal, calculateServiceFee, resolveServiceFeeRate } from './calc';
import { getOrderItemDisplayName, parseItemNote } from './labels';
import { contaTemTaxaPercentual } from './taxas';

type ItemLike = { id: string; quantity: number; price_at_time: number; status?: string; created_at?: string; notes?: string | null; product?: any; selected_options?: any };
type OrderLike = { id: string; table_id?: string | null; order_items?: ItemLike[] | null };

function itensAtivos(tableId: string, orders: OrderLike[]): { order: OrderLike; item: ItemLike }[] {
  return orders
    .filter((o) => o.table_id === tableId)
    .flatMap((o) => (o.order_items || []).filter((i) => i.status !== 'canceled').map((item) => ({ order: o, item })));
}

// Mesma mesa + mesmos itens = mesma chave: garçom e caixa (ou dois PCs) nunca imprimem a mesma pré-conta 2x;
// entrou item novo (ou o caixa editou o valor da taxa), a chave muda e a nova pré-conta sai.
export function chavePreConta(tableId: string, orders: OrderLike[]): string {
  const ids = itensAtivos(tableId, orders).map(({ item }) => `${item.id.slice(0, 8)}x${item.quantity}@${item.price_at_time}`).sort().join(',');
  let h = 0;
  for (let i = 0; i < ids.length; i++) h = (Math.imul(31, h) + ids.charCodeAt(i)) | 0;
  return `pre-conta:${tableId}:${(h >>> 0).toString(36)}`;
}

export function montarPreConta(
  store: { name: string; cnpj?: string | null; config?: any },
  table: { id: string; number: number | string; service_fee_removed?: boolean | null },
  orders: OrderLike[],
) {
  const itens = itensAtivos(table.id, orders)
    .map(({ item }) => item)
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  if (itens.length === 0) return null;
  const subtotal = itens.reduce((s, i) => s + i.price_at_time * i.quantity, 0);
  const rate = resolveServiceFeeRate(store.config);
  const cobra = !!store.config?.charge_service_fee;
  // Taxa de serviço já lançada como item pelo caixa (migration 138): sai na lista, o automático não soma.
  const temTaxaItem = contaTemTaxaPercentual(itens);
  const removida = cobra && !!table.service_fee_removed && !temTaxaItem;
  const charged = cobra && !removida && !temTaxaItem;
  return {
    storeName: store.name,
    cnpj: store.cnpj ?? undefined,
    paperWidthMm: store.config?.printer_paper_width_mm,
    label: `MESA ${table.number}`,
    items: itens.map((i) => ({
      quantity: i.quantity,
      name: getOrderItemDisplayName(i as any),
      client: parseItemNote(i.notes || '').client,
      total: i.price_at_time * i.quantity,
    })),
    subtotal,
    serviceFee: { charged, rate, amount: charged ? calculateServiceFee(subtotal, rate) : 0, removedForTable: removida },
    total: calculateOrderTotal(subtotal, charged, rate),
  };
}

// Interruptor da pré-conta (comanda com preços) AUTOMÁTICA, em Configurações > Impressão. Ligado por padrão (comportamento de
// sempre); `config.auto_pre_conta === false` desliga: nem o "Pedir conta" do garçom nem o PC do caixa mandam a pré-conta sozinhos.
// O botão manual Imprimir da mesa não é afetado. Em qual impressora sai: marcar "Pré-conta" na impressora (aba Impressão).
export function preContaAutomaticaLigada(config: object | null | undefined): boolean {
  return (config as { auto_pre_conta?: boolean } | null | undefined)?.auto_pre_conta !== false;
}
