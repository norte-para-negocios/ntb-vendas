// rodar com: npx tsx scripts/testes/configPatch.test.ts
import assert from 'node:assert/strict';
import { aplicarPatch } from '../../lib/configPatch';

assert.deepEqual(aplicarPatch(undefined, { a: 1 }), { a: 1 });
assert.deepEqual(aplicarPatch({ a: 1, b: 2 }, { b: 3 }), { a: 1, b: 3 });
const orig = { a: 1 };
aplicarPatch(orig, { a: 2 });
assert.deepEqual(orig, { a: 1 }, 'não muta o original');
assert.deepEqual(aplicarPatch({ a: 1, charge_service_fee: true }, { charge_service_fee: undefined }), { a: 1 });
assert.equal('charge_service_fee' in aplicarPatch({ charge_service_fee: true }, { charge_service_fee: undefined }), false);
assert.deepEqual(aplicarPatch({}, { client_ordering: false }), { client_ordering: false });
const antes = { x: 1 };
const depois = aplicarPatch(antes, { x: 2, y: 5 });
assert.deepEqual(aplicarPatch(depois, { x: antes.x, y: undefined }), antes);
console.log('configPatch: ok');
