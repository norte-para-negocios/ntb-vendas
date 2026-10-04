// rodar com: npx tsx scripts/testes/periodo.test.ts
import assert from 'node:assert/strict';
import { limitesDoPeriodo, rotuloPeriodo } from '../../lib/reports/dia';
const [ini, fim] = limitesDoPeriodo('2026-10-01', '2026-10-31');
assert.equal(ini.toISOString(), '2026-10-01T03:00:00.000Z');
assert.equal(fim.toISOString(), '2026-11-01T02:59:59.999Z');
assert.throws(() => limitesDoPeriodo('2026-10-05', '2026-10-01'), /periodo-invalido/);
assert.throws(() => limitesDoPeriodo('2026-09-01', '2026-10-31'), /periodo-invalido/, 'mais de 31 dias');
assert.equal(limitesDoPeriodo('2026-10-04', '2026-10-04')[1].toISOString(), '2026-10-05T02:59:59.999Z', 'um dia só vale');
assert.equal(rotuloPeriodo('2026-10-04', '2026-10-04'), '04/10/2026');
assert.equal(rotuloPeriodo('2026-10-01', '2026-10-07'), '01/10/2026 a 07/10/2026');
console.log('periodo: ok');
