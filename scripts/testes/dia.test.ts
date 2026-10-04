// rodar com: npx tsx scripts/testes/dia.test.ts
import assert from 'node:assert/strict';
import { limitesDoDia, turnosDoPeriodo } from '../../lib/reports/dia';

const [ini, fim] = limitesDoDia('2026-10-04');
assert.equal(ini.toISOString(), '2026-10-04T03:00:00.000Z', 'início do dia em Bahia (UTC-3)');
assert.equal(fim.toISOString(), '2026-10-05T02:59:59.999Z', 'fim do dia em Bahia');
const rows = [
  { id: 'a', opened_at: '2026-10-04T02:59:59.000Z' }, // 23h59 do dia anterior em Bahia
  { id: 'b', opened_at: '2026-10-04T03:00:00.000Z' }, // 00h00
  { id: 'c', opened_at: '2026-10-05T02:59:59.000Z' }, // 23h59
  { id: 'd', opened_at: '2026-10-05T03:00:00.000Z' }, // dia seguinte
];
assert.deepEqual(turnosDoPeriodo(rows, ini, fim).map((r) => r.id), ['b', 'c'], 'turno que abre à noite conta no dia em que abriu (Review Focus 4)');
console.log('dia: ok');
