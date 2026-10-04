// rodar com: npx tsx scripts/testes/preContaAutomatica.test.ts
import assert from 'node:assert/strict';
import { preContaAutomaticaLigada } from '../../lib/preConta';
assert.equal(preContaAutomaticaLigada(undefined), true);
assert.equal(preContaAutomaticaLigada(null), true);
assert.equal(preContaAutomaticaLigada({}), true);
assert.equal(preContaAutomaticaLigada({ auto_pre_conta: true }), true);
assert.equal(preContaAutomaticaLigada({ auto_pre_conta: false }), false);
console.log('preContaAutomatica: ok');
