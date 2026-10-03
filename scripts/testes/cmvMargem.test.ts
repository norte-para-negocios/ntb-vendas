// rodar com: npx tsx scripts/testes/cmvMargem.test.ts
import assert from 'node:assert/strict';
import { calculateMargin } from '../../lib/calc';

// Margem normal: vendeu 100, custou 40 → margem 60%
assert.deepEqual(calculateMargin(100, 40), { profit: 60, marginPct: 60 });
// Custo zero → margem 100%
assert.deepEqual(calculateMargin(50, 0), { profit: 50, marginPct: 100 });
// Custo null/undefined → sem margem calculável
assert.equal(calculateMargin(100, null), null);
assert.equal(calculateMargin(100, undefined), null);
// Receita zero → margem 0% (evita divisão por zero)
assert.deepEqual(calculateMargin(0, 0), { profit: 0, marginPct: 0 });
// Custo maior que receita → margem negativa
assert.deepEqual(calculateMargin(30, 50), { profit: -20, marginPct: -66.67 });

console.log('cmvMargem: ok');