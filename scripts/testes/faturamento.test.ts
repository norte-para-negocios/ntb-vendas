// rodar com: npx tsx scripts/testes/faturamento.test.ts
// Casos tirados dos dados reais do Sertão (08/10/2026).
import assert from 'node:assert/strict';
import { valorFaturado, cortesiaDaVenda, agruparPorConta, decomporVenda, chaveContaPaga, configTaxaDaLoja } from '../../lib/faturamento';

const item = (preco: number, qtd = 1, extra: Record<string, unknown> = {}) => ({ quantity: qtd, price_at_time: preco, ...extra });
const cfg = { cobraTaxa: true, percentual: 0.1 };

// 1) payment_details.total SEM a taxa (159,90) e pago 170: o valor é o pago, a taxa aparece.
const semTaxaNoTotal = { id: 'a', table_id: 't1', payment_details: { total: 159.9, methods: [{ method: 'CREDIT', amount: 170, brand: 'mastercard' }] }, order_items: [item(159.9)] };
assert.equal(valorFaturado(semTaxaNoTotal), 170);
const d1 = decomporVenda(semTaxaNoTotal, cfg);
assert.equal(d1.taxa, 10.1);
assert.equal(d1.excesso, 0);
assert.equal(+(d1.itens - d1.desconto + d1.taxa + d1.outras + d1.excesso - d1.cortesia).toFixed(2), 170);

// 2) Cortesia não é faturamento (ODARA: 7,00 + taxa, tudo em cortesia).
const cortesiaTotal = { id: 'b', table_id: 't2', payment_details: { total: 7.7, methods: [{ method: 'COURTESY', amount: 7.7 }] }, order_items: [item(7)] };
assert.equal(valorFaturado(cortesiaTotal), 0);
assert.equal(cortesiaDaVenda(cortesiaTotal), 7.7);
assert.deepEqual(decomporVenda(cortesiaTotal, cfg).taxa, 0, 'conta 100% cortesia não tem taxa');

// Cortesia parcial (arredondamento de 0,29 no Sertão): sai do valor, a conta fecha.
const cortesiaParcial = { id: 'c', table_id: 't3', payment_details: { total: 136.29, methods: [{ method: 'DEBIT', amount: 136, brand: 'mastercard' }, { method: 'COURTESY', amount: 0.29 }] }, order_items: [item(123.9)] };
const d3 = decomporVenda(cortesiaParcial, cfg);
assert.equal(valorFaturado(cortesiaParcial), 136);
assert.equal(+(d3.itens - d3.desconto + d3.taxa + d3.outras + d3.excesso - d3.cortesia).toFixed(2), 136);

// 3) Conta fechada em zero (tudo cancelado): vale 0, mesmo com orders.total cheio.
const zerada = { id: 'z', table_id: 't4', payment_details: { total: 0, methods: [] }, order_items: [item(124.9, 1, { status: 'canceled' })] };
assert.equal(valorFaturado(zerada), 0);

// 4) Mesma conta em 2 pedidos (pedido da taxa lançada pelo caixa) e um deles ganhou marcas depois: soma UMA vez.
const pdBase = { total: 487.08, methods: [{ method: 'CREDIT', amount: 413.5, brand: 'visa' }, { method: 'PIX', amount: 73.58 }], operador_id: 'op', cash_shift_id: 's' };
const principal = { id: 'p1', table_id: 't22', payment_details: { ...pdBase, op_enviada_em: '2026-10-04' }, order_items: [item(442.79)] };
const pedidoTaxa = { id: 'p2', table_id: 't22', payment_details: pdBase, order_items: [item(44.29, 1, { product: { fee_type: 'percent' } })] };
assert.equal(chaveContaPaga(principal), chaveContaPaga(pedidoTaxa));
const contas = agruparPorConta([pedidoTaxa, principal]);
assert.equal(contas.length, 1);
assert.equal(contas[0].id, 'p1', 'fica com o id do pedido com produtos');
assert.equal(contas.reduce((s, c) => s + valorFaturado(c), 0), 487.08);
const d4 = decomporVenda(contas[0], cfg);
assert.equal(d4.itens, 442.79);
assert.equal(d4.taxa, 44.29);
assert.equal(d4.excesso, 0);

// Pagamentos diferentes da mesma mesa não se juntam.
const outraConta = { id: 'p3', table_id: 't22', payment_details: { ...pdBase, payment_id: 'x' }, order_items: [item(10)] };
assert.equal(agruparPorConta([principal, outraConta]).length, 2);

// 5) Cupom: a taxa sai da base com desconto.
const comCupom = { id: 'd', coupon_discount: 10, payment_details: { methods: [{ method: 'PIX', amount: 99 }] }, order_items: [item(100)] };
const d5 = decomporVenda(comCupom, cfg);
assert.equal(d5.taxa, 9);
assert.equal(d5.excesso, 0);

// 6) Pagou bem acima dos 10% (426 -> 477): até 10% é taxa, o resto é "pago a mais".
const acima = { id: 'e', table_id: 't12', payment_details: { total: 426, methods: [{ method: 'DEBIT', amount: 477 }] }, order_items: [item(426)] };
const d6 = decomporVenda(acima, cfg);
assert.equal(d6.taxa, 42.61);
assert.equal(d6.excesso, 8.39);

// Loja que não cobra taxa: tudo acima dos itens é "pago a mais".
assert.equal(decomporVenda(acima, { cobraTaxa: false, percentual: 0.1 }).taxa, 0);

// Venda antiga sem formas gravadas: total gravado.
assert.equal(valorFaturado({ id: 'v', payment_details: { total: 50 }, order_items: [item(45)] }), 50);
assert.equal(valorFaturado({ id: 'w', order_items: [item(45), item(5, 1, { status: 'canceled' })] }), 45);

assert.deepEqual(configTaxaDaLoja({ charge_service_fee: true, service_fee_rate: 0.12 }), { cobraTaxa: true, percentual: 0.12 });
assert.deepEqual(configTaxaDaLoja(null), { cobraTaxa: false, percentual: 0.1 });

console.log('faturamento: ok');
