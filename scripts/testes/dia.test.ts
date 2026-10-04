// rodar com: npx tsx scripts/testes/dia.test.ts
import assert from 'node:assert/strict';
import { limitesDoDia, turnosDoPeriodo, turnoParcial } from '../../lib/reports/dia';

const [ini, fim] = limitesDoDia('2026-10-04');
assert.equal(ini.toISOString(), '2026-10-04T03:00:00.000Z', 'início do dia em Bahia (UTC-3)');
assert.equal(fim.toISOString(), '2026-10-05T02:59:59.999Z', 'fim do dia em Bahia');
const rows = [
  { id: 'a', opened_at: '2026-10-03T20:00:00.000Z', closed_at: '2026-10-04T02:59:59.000Z' }, // fechou antes do dia começar
  { id: 'b', opened_at: '2026-10-04T03:00:00.000Z', closed_at: '2026-10-04T10:00:00.000Z' }, // dentro
  { id: 'c', opened_at: '2026-10-05T02:59:59.000Z', closed_at: null },                       // abriu 23h59, ainda aberto
  { id: 'd', opened_at: '2026-10-05T03:00:00.000Z', closed_at: null },                       // abriu no dia seguinte
  { id: 'e', opened_at: '2026-09-12T21:00:00.000Z', closed_at: null },                       // esquecido aberto há semanas: atravessa o dia
  { id: 'f', opened_at: '2026-10-03T22:00:00.000Z', closed_at: '2026-10-04T08:00:00.000Z' }, // abriu na véspera, fechou no dia
];
assert.deepEqual(turnosDoPeriodo(rows, ini, fim).map((r) => r.id), ['b', 'c', 'e', 'f'], 'turno que se sobrepõe ao dia entra, aberto ou fechado depois do início; sem repetir');
assert.equal(turnoParcial(rows[1], ini, fim), false, 'inteiro dentro do dia');
assert.equal(turnoParcial(rows[2], ini, fim), true, 'continua depois do dia');
assert.equal(turnoParcial(rows[4], ini, fim), true, 'aberto antes do dia');
assert.equal(turnoParcial(rows[5], ini, fim), true, 'abriu antes do dia');
console.log('dia: ok');
