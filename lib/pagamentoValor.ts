// Conferência do valor pago no servidor (Task 5): o pagamento não pode ser menor que o que o pedido vale.
// Mesma regra de close_table_orders_v2 (migration 191). Puro: testado em scripts/testes/pagamentoBalcaoValor.test.ts.

type ItemValor = { quantity: number; price_at_time: number; status?: string | null };
type DetalhesPagamento = { total: number; methods: { method: string; amount: number }[] };

const TOLERANCIA = 0.01;

/** Soma dos itens não cancelados, em 2 casas. */
export function totalDosItens(itens: ItemValor[] | null | undefined): number {
  const soma = (itens || [])
    .filter((i) => i.status !== 'canceled')
    .reduce((acc, i) => acc + (Number(i.quantity) || 0) * (Number(i.price_at_time) || 0), 0);
  return Math.round(soma * 100) / 100;
}

/** null = valor ok; senão, a mensagem para a tela. Cortesia não confere valor. */
export function conferirValorPago(detalhes: DetalhesPagamento, totalDevido: number): string | null {
  if (detalhes.methods.some((m) => m.method === 'COURTESY')) return null;
  const somaFormas = detalhes.methods.reduce((acc, m) => acc + (Number(m.amount) || 0), 0);
  const total = Number(detalhes.total);
  if (!Number.isFinite(total) || total < totalDevido - TOLERANCIA || !(somaFormas >= totalDevido - TOLERANCIA)) {
    return `O valor pago é menor que o total do pedido (R$ ${totalDevido.toFixed(2).replace('.', ',')}). Confira a conta e receba de novo.`;
  }
  return null;
}
