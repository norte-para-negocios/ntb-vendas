// rodar com: npx tsx scripts/testes/calcArredonda.test.ts
// Taxa de serviço e divisão da conta sempre em centavos (02/11/2026): antes a taxa saía com 3+ casas (33,33 -> 3,333)
// e a soma das partes por pessoa podia não bater com o total da mesa.
import assert from 'node:assert/strict';
import { calculateServiceFee, calculateOrderTotal, calculateSplitByPerson, centavos } from '../../lib/calc';
import { montarDivisao } from '../../lib/divisaoPorPessoa';

const duasCasas = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;

assert.equal(calculateServiceFee(33.33), 3.33);
assert.equal(calculateOrderTotal(33.33, true), 36.66);
assert.equal(calculateServiceFee(0.05), 0.01); // meio centavo arredonda para cima
assert.equal(calculateServiceFee(10.05), 1.01); // 1,005 com ruído de ponto flutuante
assert.equal(calculateServiceFee(100, 0.125), 12.5);
assert.equal(calculateServiceFee(0), 0);
assert.equal(calculateOrderTotal(33.33, false), 33.33);
assert.equal(calculateOrderTotal(33.33, true, 0.1, true), 33.33);
assert.equal(centavos(0.1 + 0.2), 0.3);
assert.equal(centavos(1.005), 1.01);

// 3 pessoas com 10 cada, taxa 10%: soma = total da mesa (33,00), cada parte com 2 casas.
const tres = calculateSplitByPerson([{ userName: 'A', subtotal: 10 }, { userName: 'B', subtotal: 10 }, { userName: 'C', subtotal: 10 }], true);
const soma = [...tres.values()].reduce((s, v) => s + v, 0);
assert.equal(centavos(soma), 33);
assert.equal(centavos(soma), calculateOrderTotal(30, true));
for (const v of tres.values()) assert.ok(duasCasas(v), `parte com mais de 2 casas: ${v}`);

// Centavo que sobra vai para a última parte: 3 x 3,33 (+10%) = 10,99 na mesa; partes 3,66 + 3,66 + 3,67.
const sobra = calculateSplitByPerson([{ userName: 'A', subtotal: 3.33 }, { userName: 'B', subtotal: 3.33 }, { userName: 'C', subtotal: 3.33 }], true);
assert.deepEqual([...sobra.entries()], [['A', 3.66], ['B', 3.66], ['C', 3.67]]);
assert.equal(centavos([...sobra.values()].reduce((s, v) => s + v, 0)), calculateOrderTotal(9.99, true));

// Várias linhas da mesma pessoa somam antes; sem taxa a soma também bate.
const semTaxa = calculateSplitByPerson([{ userName: 'A', subtotal: 0.1 }, { userName: 'A', subtotal: 0.2 }, { userName: 'B', subtotal: 1 }], false);
assert.deepEqual([...semTaxa.entries()], [['A', 0.3], ['B', 1]]);

// Muitas pessoas com valores quebrados: soma sempre = total da mesa.
const pessoas = Array.from({ length: 7 }, (_, i) => ({ userName: `P${i}`, subtotal: 12.37 + i * 1.11 }));
const muitas = calculateSplitByPerson(pessoas, true, 0.12);
const totalMesa = calculateOrderTotal(centavos(pessoas.reduce((s, p) => s + p.subtotal, 0)), true, 0.12);
assert.equal(centavos([...muitas.values()].reduce((s, v) => s + v, 0)), totalMesa);
for (const v of muitas.values()) assert.ok(duasCasas(v));

// Divisão "Por pessoa": subtotal em centavos (sem 0,30000000000000004).
const div = montarDivisao(
  [{ id: 'i1', quantity: 1, price_at_time: 0.1 }, { id: 'i2', quantity: 1, price_at_time: 0.2 }],
  { i1: { Ana: 1 }, i2: { Ana: 1 } },
  ['Ana'],
);
assert.equal(div.pessoas[0].subtotal, 0.3);

console.log('calcArredonda: ok');
