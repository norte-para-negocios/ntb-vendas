// rodar com: npx tsx scripts/testes/alergenicos.test.ts
import assert from 'node:assert/strict';
import { getAllergenLabels } from '../../lib/labels';
import { buildKitchenTicketText } from '../../lib/print';

assert.deepEqual(getAllergenLabels(['picante', 'alergia_frutos_do_mar', 'alergia_gluten']), ['glúten', 'frutos do mar']);
assert.deepEqual(getAllergenLabels(null), []);
assert.deepEqual(getAllergenLabels(['vegano']), []);

const texto = buildKitchenTicketText({
  kind: 'COZINHA', storeName: 'T', orderType: 'MESA', identifier: 'MESA 1', client: null, orderIdShort: 'abc',
  items: [{ quantity: 1, productName: 'Moqueca', alergenicos: ['frutos do mar'] }, { quantity: 1, productName: 'Batata' }],
} as any);
assert.ok(texto.includes('ALERGIA: FRUTOS DO MAR'), 'comanda mostra alergia');
assert.equal((texto.match(/ALERGIA/g) || []).length, 1, 'só o item com alergênico');
console.log('alergenicos: ok');
