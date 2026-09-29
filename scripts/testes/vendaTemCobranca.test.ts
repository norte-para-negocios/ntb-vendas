// rodar com: npx tsx scripts/testes/vendaTemCobranca.test.ts
import assert from 'node:assert/strict';
import { vendaTemCobranca } from '../../lib/calc';

assert.equal(vendaTemCobranca({ total: 53.68 }), true);
assert.equal(vendaTemCobranca({ total: 0.01 }), true);
assert.equal(vendaTemCobranca({ total: 0 }), false);      // mesa vazia finalizada
assert.equal(vendaTemCobranca({ total: -1 }), false);
assert.equal(vendaTemCobranca({ total: NaN }), false);
assert.equal(vendaTemCobranca(undefined), true);          // sem paymentData: comportamento antigo, não mexe
assert.equal(vendaTemCobranca(null), true);
console.log('ok');
