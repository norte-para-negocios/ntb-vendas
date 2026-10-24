// rodar com: npx tsx scripts/testes/agruparItens.test.ts
import assert from 'node:assert/strict';
import { agruparItensIguais } from '../../lib/agruparItens';

const it = (id: string, p: string, q: number, preco: number, notes = '', opcoes: string[] = [], t = '2026-10-24T12:00:00Z') =>
  ({ id, product_id: p, quantity: q, price_at_time: preco, notes, selected_options: opcoes.map((name) => ({ name })), created_at: t });

const g = agruparItensIguais([
  it('a', 'petra', 1, 20, '[Milky]'),
  it('b', 'petra', 1, 20, '[Thaylane]', [], '2026-10-24T12:05:00Z'),
  it('c', 'petra', 2, 20, '[Milky] sem gelo'),
  it('d', 'pizza', 1, 80, '', ['Grande', 'Calabresa']),
  it('e', 'pizza', 1, 80, '', ['Calabresa', 'Grande']),
  it('f', 'pizza', 1, 80, '', ['Média']),
]);
assert.equal(g.length, 4);
assert.deepEqual(g[0].itens.map((i) => i.id), ['a', 'b']); // quem lançou não separa
assert.equal(g[0].quantidade, 2);
assert.equal(g[0].total, 40);
assert.equal(g[0].ultimo, '2026-10-24T12:05:00Z');
assert.deepEqual(g[1].itens.map((i) => i.id), ['c']); // observação diferente separa
assert.deepEqual(g[2].itens.map((i) => i.id), ['d', 'e']); // mesma escolha em outra ordem junta
assert.deepEqual(g[3].itens.map((i) => i.id), ['f']);
assert.equal(agruparItensIguais([]).length, 0);
console.log('agruparItens: ok');
