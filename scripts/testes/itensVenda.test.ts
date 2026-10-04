// rodar com: npx tsx scripts/testes/itensVenda.test.ts
import assert from 'node:assert/strict';
import { itensAtivos, itensCancelados, qtdItensAtivos, subtotalItensAtivos, rotuloQtdItens } from '../../lib/itensVenda';

const it = (id: string, q: number, p: number, status = 'delivered') => ({ id, quantity: q, price_at_time: p, status });
const venda = { order_items: [it('a', 2, 10), it('b', 1, 30), it('c', 1, 20, 'canceled'), it('d', 1, 5)] };

assert.equal(qtdItensAtivos(venda), 3, 'cancelado não conta na coluna Itens (4 linhas, 1 cancelada = 3)');
assert.equal(itensAtivos(venda).length, 3);
assert.deepEqual(itensCancelados(venda).map((i) => i.id), ['c']);
assert.equal(subtotalItensAtivos(venda), 55, 'subtotal fora o item cancelado (20 + 30 + 5)');
assert.equal(qtdItensAtivos({}), 0, 'sem order_items');
assert.equal(subtotalItensAtivos({ order_items: undefined }), 0);
assert.equal(rotuloQtdItens(1), '1 item');
assert.equal(rotuloQtdItens(3), '3 itens');
assert.equal(rotuloQtdItens(0), '0 itens');
console.log('itensVenda: ok');
