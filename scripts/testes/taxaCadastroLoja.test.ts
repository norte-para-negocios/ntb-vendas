import assert from 'node:assert/strict';
import { cobrancaTaxaDoCadastro } from '../../lib/calc';

// Loja nova: a taxa digitada liga (>0) ou desliga (0) a cobrança.
assert.equal(cobrancaTaxaDoCadastro(true, false, 10), true);
assert.equal(cobrancaTaxaDoCadastro(true, false, 0), false);
// Edição sem mexer no campo: não toca no interruptor gravado (regressão das lojas existentes).
assert.equal(cobrancaTaxaDoCadastro(false, false, 10), undefined);
assert.equal(cobrancaTaxaDoCadastro(false, false, 0), undefined);
// Edição mexendo na taxa: segue o valor.
assert.equal(cobrancaTaxaDoCadastro(false, true, 12), true);
assert.equal(cobrancaTaxaDoCadastro(false, true, 0), false);
assert.equal(cobrancaTaxaDoCadastro(false, true, Number.NaN), false);
console.log('taxaCadastroLoja: ok');
