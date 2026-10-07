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
const auto = montarFechamento(pedido(), [item()], [], taxa);
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

console.log('fechamentoFaturamento: ok');
