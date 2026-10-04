// rodar com: npx tsx scripts/testes/caixaResumo.test.ts
import assert from 'node:assert/strict';
import { completarFormas, completarCartoes, ticketMedio } from '../../lib/caixaResumo';

const f = completarFormas({ PIX: 10, CREDIT: 5 });
assert.deepEqual(f.map((x) => x.key), ['CASH', 'PIX', 'DEBIT', 'CREDIT'], 'sempre os 4 meios, em ordem');
assert.equal(f[0].total, 0, 'dinheiro zerado aparece');
assert.equal(completarFormas({ COURTESY: 7 }).length, 5, 'outro meio com valor entra no fim');
assert.equal(completarFormas({ COURTESY: 0 }).length, 4, 'outro meio zerado não aparece');

const c = completarCartoes({ 'CREDIT|visa': 100, 'DEBIT|visa': 50, 'CREDIT|alelo': 20, 'DEBIT|alelo': 5, 'CREDIT|cabal': 9, 'CREDIT|': 3 });
assert.equal(c.length, 12 + 2, '12 linhas fixas + cabal + sem bandeira');
assert.equal(c.find((x) => x.label.startsWith('Visa'))!.total, 100);
assert.equal(c.find((x) => x.label.startsWith('Electron'))!.total, 50, 'Visa débito = Electron');
assert.equal(c.find((x) => x.label === 'Alelo')!.total, 25, 'vale soma crédito+débito');
assert.equal(c.find((x) => x.label.startsWith('Mastercard'))!.total, 0, 'bandeira sem venda aparece zerada');
assert.equal(c[0].label, 'Mastercard crédito', 'ordem da folha');

assert.equal(ticketMedio(4520.92, 34), 132.97);
assert.equal(ticketMedio(100, 0), null);
assert.equal(ticketMedio(null, null), null);
console.log('caixaResumo: ok');
