// rodar com: npx tsx scripts/testes/fechamentoFaturamento.test.ts
// Fechamento de venda enviado ao Estoque (lojas em modo 'proprio'): itens, pagamentos, taxa, nota e data estável.
import assert from 'node:assert/strict';
import { montarFechamento, dataHoraBrasilia, type PedidoFechamento, type ItemFechamento } from '../../lib/fechamentoFaturamento';

const pedido = (extra: Partial<PedidoFechamento> = {}): PedidoFechamento => ({
  id: 'ped-1', order_type: 'dine_in', customer_name: null, created_at: '2026-10-07T00:30:00Z', updated_at: '2026-10-07T01:10:00Z',
  payment_details: { methods: [{ method: 'CREDIT', amount: 50, brand: 'elo' }], operador_nome: 'Ana' }, mesa: 12, ...extra,
});
const item = (extra: Partial<ItemFechamento> = {}): ItemFechamento => ({
  quantity: 2, status: 'delivered', price_at_time: 14, product: { name: 'Cerveja', omie_codigo: '90001', ncm: '22030000', fee_type: null }, ...extra,
});

// Brasília: 00:30 UTC de 07/10 é 21:30 de 06/10.
assert.deepEqual(dataHoraBrasilia('2026-10-07T00:30:00Z'), { data: '2026-10-06', hora: '21:30:00' });

// Venda de mesa com 2 itens e um pagamento.
const p = montarFechamento(pedido(), [item(), item({ quantity: 1, price_at_time: 22, product: { name: 'Caipirinha', omie_codigo: '90005', ncm: null, fee_type: null } })], []);
assert.equal(p.data, '2026-10-06');
assert.equal(p.tipo, 'mesa');
assert.equal(p.mesa, '12');
assert.equal(p.itens.length, 2);
assert.equal(p.itens[0].valor, 28);
assert.equal(p.valor, 50);
assert.equal(p.pagamentos[0].metodo, 'CREDIT');
assert.equal(p.pagamentos[0].bandeira, 'elo');
assert.equal(p.operador, 'Ana');
assert.equal(p.nota, null);

// Item cancelado não entra; balcão sem mesa.
const b = montarFechamento(pedido({ order_type: 'counter', mesa: null }), [item(), item({ status: 'canceled', quantity: 9 })], []);
assert.equal(b.tipo, 'balcao');
assert.equal(b.itens.length, 1);
assert.equal(b.valor, 28);

// Data estável: a emissão da nota vence; updated_at (que muda a cada marca do outbox) nunca decide.
const comNota = montarFechamento(pedido({ updated_at: '2026-10-09T10:00:00Z' }), [item()], [
  { chave_acesso: 'c'.repeat(44), numero: 140, serie: 1, status: 'autorizada', created_at: '2026-10-07T00:35:00Z' },
  { chave_acesso: null, numero: 141, serie: 1, status: 'erro', created_at: '2026-10-08T00:35:00Z' },
]);
assert.equal(comNota.data, '2026-10-06');
assert.equal(comNota.nota?.numero, 140, 'nota com erro ou cancelada não conta');
assert.equal(comNota.nota?.chave?.length, 44);

// Taxa de serviço automática vira item quando a loja cobra e não há taxa lançada; não duplica se já foi lançada.
const taxa = { codigo: '90875', nome: 'Taxa de Serviço', percentual: 10 };
const auto = montarFechamento(pedido({ payment_details: { methods: [{ method: 'CREDIT', amount: 30.8, brand: 'elo' }], operador_nome: 'Ana' } }), [item()], [], taxa);
assert.equal(auto.itens.length, 2);
assert.equal(auto.itens[1].codigo, '90875');
assert.equal(auto.itens[1].valor, 2.8);
assert.equal(auto.taxa, 2.8);
assert.equal(auto.valor, 30.8);
const lancada = montarFechamento(pedido(), [item(), item({ quantity: 1, price_at_time: 3, product: { name: 'Taxa de Serviço', omie_codigo: '90875', ncm: null, fee_type: 'percent' } })], [], taxa);
assert.equal(lancada.itens.length, 2, 'taxa lançada não é somada de novo');
assert.equal(lancada.taxa, 3);

// Pagamento zerado (cortesia) não gera linha de pagamento; produto sem código sai com código vazio (o Estoque trata como não identificado).
const cortesia = montarFechamento(pedido({ payment_details: { methods: [{ method: 'COURTESY', amount: 0 }] } }), [item({ product: null })], []);
assert.equal(cortesia.pagamentos.length, 0);
assert.equal(cortesia.itens[0].codigo, '');
assert.equal(cortesia.itens[0].nome, 'Produto não identificado');

// A taxa vale o que o cliente pagou: total 33,60 sobre itens 28 = taxa 5,60 (taxa editada para 20%).
const paga = montarFechamento(pedido({ payment_details: { methods: [{ method: 'CASH', amount: 33.6 }], total: 33.6 } }), [item()], [], taxa);
assert.equal(paga.taxa, 5.6);
assert.equal(paga.valor, 33.6);
// "Tirar a taxa": total = itens -> sem taxa (nenhum item de taxa).
const tirada = montarFechamento(pedido({ payment_details: { methods: [{ method: 'CASH', amount: 28 }], total: 28 } }), [item()], [], taxa);
assert.equal(tirada.taxa, 0);
assert.equal(tirada.itens.length, 1);
// Loja que cobra sem o produto de taxa cadastrado: a taxa entra sem código (antes sumia do faturamento).
const semProduto = montarFechamento(pedido({ payment_details: { methods: [{ method: 'CASH', amount: 30.8 }], total: 30.8 } }), [item()], [], { codigo: '', nome: 'Taxa de Serviço', percentual: 10 });
assert.equal(semProduto.taxa, 2.8);
assert.equal(semProduto.itens[1].codigo, '');
assert.equal(semProduto.valor, 30.8);

// Cupom de desconto do pedido (orders.coupon_discount): sai do faturamento, rateado nos itens (o relatório soma os itens).
// Itens 28 + 22 = 50, cupom 5 -> 2,80 na cerveja e 2,20 na caipirinha; valor 45. Antes o cupom era ignorado e o
// faturamento ficava R$ 5 acima do que o cliente pagou.
const cupom = montarFechamento(pedido({ coupon_discount: 5 }), [item(), item({ quantity: 1, price_at_time: 22, product: { name: 'Caipirinha', omie_codigo: '90005', ncm: null, fee_type: null } })], []);
assert.equal(cupom.desconto, 5);
assert.equal(cupom.valor, 45);
assert.equal(cupom.itens[0].desconto, 2.8);
assert.equal(cupom.itens[0].valor, 25.2);
assert.equal(cupom.itens[1].desconto, 2.2);
assert.equal(cupom.itens[1].valor, 19.8);
// Arredondamento: a última linha absorve a sobra, o rateio fecha exato com o cupom.
const tres = montarFechamento(pedido({ coupon_discount: 10 }), [item({ quantity: 1, price_at_time: 10 }), item({ quantity: 1, price_at_time: 10 }), item({ quantity: 1, price_at_time: 10 })], []);
assert.equal(Math.round(tres.itens.reduce((s, l) => s + l.desconto, 0) * 100) / 100, 10);
assert.equal(tres.valor, 20);
// Cupom + taxa paga: total 49,50 = itens 50 - cupom 5 + taxa 4,50 -> a taxa é 4,50 (não 0, nem 4,50 - 5).
const cupomTaxa = montarFechamento(pedido({ coupon_discount: 5, payment_details: { methods: [{ method: 'PIX', amount: 49.5 }], total: 49.5 } }),
  [item(), item({ quantity: 1, price_at_time: 22, product: { name: 'Caipirinha', omie_codigo: '90005', ncm: null, fee_type: null } })], [], taxa);
assert.equal(cupomTaxa.taxa, 4.5);
assert.equal(cupomTaxa.valor, 49.5);
// Cupom maior que os itens nunca deixa item negativo.
const cupomGrande = montarFechamento(pedido({ coupon_discount: 999 }), [item()], []);
assert.equal(cupomGrande.desconto, 28);
assert.equal(cupomGrande.valor, 0);

// Pizza meio a meio: o produto não tem código; os sabores (opções com código) vão como componentes da linha.
const meio = montarFechamento(pedido(), [item({ quantity: 1, price_at_time: 59, product: { name: 'Pizza Meio a Meio', omie_codigo: null, ncm: null, fee_type: null },
  selected_options: [{ omie_codigo: '90013' }, { omie_codigo: '90014' }, { omie_codigo: null }, { omie_codigo: '90013' }] })], []);
assert.equal(meio.itens[0].codigo, '');
assert.deepEqual(meio.itens[0].componentes, ['90013', '90014'], 'sem vazio nem repetido');
assert.equal('componentes' in p.itens[0], false, 'item sem opção não manda componentes');

// Taxa sai do que foi PAGO mesmo quando payment_details.total não inclui a taxa (Sertão 08/10: total 159,90, pago 170).
const totalSemTaxa = montarFechamento(pedido({ payment_details: { methods: [{ method: 'CREDIT', amount: 30.8 }], total: 28 } }), [item()], [], taxa);
assert.equal(totalSemTaxa.taxa, 2.8);
assert.equal(totalSemTaxa.valor, 30.8);

// Cortesia não é faturamento: 100% cortesia chega com valor 0 e sem pagamento; parcial sai dos itens e da taxa.
const toda = montarFechamento(pedido({ payment_details: { methods: [{ method: 'COURTESY', amount: 30.8 }], total: 30.8 } }), [item()], [], taxa);
assert.equal(toda.valor, 0);
assert.equal(toda.taxa, 0);
assert.equal(toda.cortesia, 30.8);
assert.equal(toda.pagamentos.length, 0);
const parcial = montarFechamento(pedido({ payment_details: { methods: [{ method: 'CASH', amount: 30 }, { method: 'COURTESY', amount: 0.8 }], total: 30.8 } }), [item()], [], taxa);
assert.equal(parcial.valor, 30);
assert.equal(parcial.pagamentos.length, 1);
assert.equal(Math.round((parcial.itens.reduce((s, l) => s + l.valor, 0)) * 100) / 100, 30);

console.log('fechamentoFaturamento: ok');
