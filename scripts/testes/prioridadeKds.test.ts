// rodar com: npx tsx scripts/testes/prioridadeKds.test.ts
import assert from 'node:assert/strict';
import { sortKitchenItems } from '../../lib/calc';

const items = [
  { id: '1', priority: false, created_at: '2026-10-03T10:00:00Z' },
  { id: '2', priority: true, created_at: '2026-10-03T10:05:00Z' },
  { id: '3', priority: false, created_at: '2026-10-03T09:55:00Z' },
  { id: '4', priority: true, created_at: '2026-10-03T10:02:00Z' },
];
const sorted = sortKitchenItems(items);
// Prioritários primeiro (por created_at desc), depois normais (por created_at asc)
assert.equal(sorted[0].id, '2'); // priority, mais recente
assert.equal(sorted[1].id, '4'); // priority, menos recente
assert.equal(sorted[2].id, '3'); // normal, mais antigo
assert.equal(sorted[3].id, '1'); // normal, mais recente
console.log('prioridadeKds: ok');