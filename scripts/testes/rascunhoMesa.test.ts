import assert from 'node:assert/strict';
import { serializarRascunho, restaurarRascunho, chaveRascunho, RASCUNHO_VALIDADE_MS } from '../../lib/rascunhoMesa';

const linhas = [
  { key: 'a|', product: { id: 'a', price: 10 }, qty: 2, notes: '', selectedOptions: [] },
  { key: 'b|', product: { id: 'b', price: 5 }, qty: 1, notes: 'sem gelo', selectedOptions: [] },
];
const raw = serializarRascunho('s1', 't1', linhas, 1000);
assert.equal(chaveRascunho('s1', 't1'), 'ntb-rascunho-mesa:s1:t1');
const r = restaurarRascunho(raw, 's1', 't1', [{ id: 'a', price: 12 }], 2000);
assert.equal(r.length, 1, 'produto que sumiu do cardápio fica de fora');
assert.equal(r[0].product.price, 12, 'usa o produto atual');
assert.equal(r[0].qty, 2);
assert.deepEqual(restaurarRascunho(raw, 's2', 't1', [{ id: 'a' }], 2000), [], 'outra loja');
assert.deepEqual(restaurarRascunho(raw, 's1', 't2', [{ id: 'a' }], 2000), [], 'outra mesa');
assert.deepEqual(restaurarRascunho(raw, 's1', 't1', [{ id: 'a' }], 1000 + RASCUNHO_VALIDADE_MS + 1), [], 'velho');
assert.deepEqual(restaurarRascunho('{lixo', 's1', 't1', [{ id: 'a' }]), []);
assert.deepEqual(restaurarRascunho(null, 's1', 't1', [{ id: 'a' }]), []);
console.log('ok rascunhoMesa');
