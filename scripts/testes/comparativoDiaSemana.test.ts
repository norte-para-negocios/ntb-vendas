// rodar com: npx tsx scripts/testes/comparativoDiaSemana.test.ts
import assert from 'node:assert/strict';
import { averageStats } from '../../lib/calc';

assert.equal(averageStats([]), null);
const r = averageStats([
  { total: 1000, count: 10, ticket: 100, tableOrders: 8 },
  { total: 2000, count: 20, ticket: 100, tableOrders: 12 },
  { total: 1500, count: 10, ticket: 150, tableOrders: 10 },
])!;
assert.equal(r.days, 3);
assert.equal(r.total, 1500);
assert.equal(Math.round(r.count * 100) / 100, 13.33);
assert.equal(r.tableOrders, 10);
assert.equal(r.ticket, 112.5, 'ticket = total médio / pedidos médios (1500 / 13,33), não média dos tickets (116,67)');
console.log('comparativoDiaSemana: ok');
