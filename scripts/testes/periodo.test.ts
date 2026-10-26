// rodar com: npx tsx scripts/testes/periodo.test.ts
import assert from 'node:assert/strict';
import { periodoDoPreset, periodoAnterior, diasDoPeriodo, rotuloDoPeriodo } from '../../lib/reports/periodo';

const agora = new Date('2026-10-25T02:30:00Z'); // 23:30 de 24/10 na Bahia
const p = (x: Parameters<typeof periodoDoPreset>[0]) => { const r = periodoDoPreset(x, agora); return [r.de, r.ate]; };
assert.deepEqual(p('hoje'), ['2026-10-24', '2026-10-24']);
assert.deepEqual(p('ontem'), ['2026-10-23', '2026-10-23']);
assert.deepEqual(p('7d'), ['2026-10-18', '2026-10-24']);
assert.deepEqual(p('30d'), ['2026-09-25', '2026-10-24']);
assert.deepEqual(p('mes'), ['2026-10-01', '2026-10-24']);
assert.deepEqual(p('mes_passado'), ['2026-09-01', '2026-09-30']);
assert.deepEqual(periodoDoPreset('mes_passado', new Date('2026-01-10T15:00:00Z')).de, '2025-12-01');
assert.equal(periodoDoPreset('mes_passado', new Date('2026-01-10T15:00:00Z')).ate, '2025-12-31');
assert.deepEqual(periodoDoPreset('personalizado', agora, '2026-10-01', '2026-10-05'), { de: '2026-10-01', ate: '2026-10-05', rotulo: '01/10/2026 a 05/10/2026' });
assert.deepEqual(periodoAnterior('2026-10-01', '2026-10-07'), { de: '2026-09-24', ate: '2026-09-30' });
assert.deepEqual(periodoAnterior('2026-10-24', '2026-10-24'), { de: '2026-10-23', ate: '2026-10-23' });
assert.deepEqual(diasDoPeriodo('2026-10-30', '2026-11-01'), ['2026-10-30', '2026-10-31', '2026-11-01']);
assert.throws(() => diasDoPeriodo('2026-10-05', '2026-10-01'), /periodo-invertido/);
assert.throws(() => diasDoPeriodo('2025-01-01', '2026-10-01'), /periodo-longo/);
assert.equal(rotuloDoPeriodo('2026-10-24', '2026-10-24'), '24/10/2026');
console.log('periodo: ok');
