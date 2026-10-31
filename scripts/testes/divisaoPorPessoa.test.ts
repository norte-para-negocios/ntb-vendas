// rodar com: npx tsx scripts/testes/divisaoPorPessoa.test.ts
import assert from 'node:assert/strict';
import { atribuirUnidade, clienteDoItem, devolverUnidade, montarDivisao, type Atribuicao } from '../../lib/divisaoPorPessoa';

const garcom = { id: 'a', quantity: 2, price_at_time: 10, notes: '[Gessica Gomes]', added_by_role: 'garcom' };
const suco = { id: 'b', quantity: 1, price_at_time: 8, notes: '[Gessica Gomes] sem gelo', added_by_role: 'garcom' };
const qr = { id: 'c', quantity: 1, price_at_time: 20, notes: '[Ana]', added_by_role: 'cliente' };
const semNome = { id: 'd', quantity: 1, price_at_time: 5, notes: null, added_by_role: 'cliente' };
const cancelado = { id: 'e', quantity: 1, price_at_time: 99, notes: '[JR]', added_by_role: 'garcom', status: 'canceled' };
const itens = [garcom, suco, qr, semNome, cancelado];

assert.equal(clienteDoItem(garcom), null, 'nome do garçom nunca vira dono da conta');
assert.equal(clienteDoItem(qr), 'Ana');
assert.equal(clienteDoItem(semNome), null);

let d = montarDivisao(itens, {}, ['Pessoa 1', 'Pessoa 2']);
assert.deepEqual(d.pessoas.map((p) => p.nome), ['Ana', 'Pessoa 1', 'Pessoa 2'], 'nenhum cartão com nome de garçom');
assert.equal(d.pessoas[0].subtotal, 20);
assert.deepEqual(d.soltos.map((s) => [s.item.id, s.restante]), [['a', 2], ['b', 1], ['d', 1]], 'cancelado não entra');

let at: Atribuicao = atribuirUnidade({}, garcom, 'Pessoa 1');
at = atribuirUnidade(at, garcom, 'Pessoa 2');
const cheio = atribuirUnidade(at, garcom, 'Pessoa 2');
assert.equal(cheio, at, 'não atribui mais do que a quantidade do item');
d = montarDivisao(itens, at, ['Pessoa 1', 'Pessoa 2']);
assert.equal(d.pessoas[1].subtotal, 10, 'uma cerveja para cada');
assert.equal(d.pessoas[2].subtotal, 10);
assert.ok(!d.soltos.some((s) => s.item.id === 'a'));

at = devolverUnidade(at, 'a', 'Pessoa 2');
d = montarDivisao(itens, at, ['Pessoa 1', 'Pessoa 2']);
assert.equal(d.soltos.find((s) => s.item.id === 'a')?.restante, 1, 'devolvida volta para a lista');
const total = d.pessoas.reduce((s, p) => s + p.subtotal, 0) + d.soltos.reduce((s, x) => s + x.item.price_at_time * x.restante, 0);
assert.equal(total, 2 * 10 + 8 + 20 + 5, 'nada some nem duplica');

// Pessoa removida: as unidades dela voltam para a lista.
d = montarDivisao(itens, at, ['Pessoa 2']);
assert.equal(d.soltos.find((s) => s.item.id === 'a')?.restante, 2);
console.log('divisaoPorPessoa: ok');
