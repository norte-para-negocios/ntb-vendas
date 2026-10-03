// rodar com: npx tsx scripts/testes/comparativoProdutos.test.ts
import assert from 'node:assert/strict';
import { compareProductQuantities } from '../../lib/calc';

const atual = [{ key: 'a', name: 'A', qty: 10 }, { key: 'b', name: 'B', qty: 2 }, { key: 'c', name: 'C', qty: 5 }];
const anterior = [{ key: 'a', name: 'A', qty: 4 }, { key: 'b', name: 'B', qty: 9 }, { key: 'd', name: 'D', qty: 3 }];
const r = compareProductQuantities(atual, anterior);
assert.deepEqual(r.up.map(m => [m.key, m.delta]), [['a', 6], ['c', 5]]); // c é novo (previous 0)
assert.deepEqual(r.down.map(m => [m.key, m.delta]), [['b', -7], ['d', -3]]); // d sumiu
assert.equal(r.up[1].previous, 0);
assert.equal(compareProductQuantities([], []).up.length, 0);
console.log('comparativoProdutos: ok');
