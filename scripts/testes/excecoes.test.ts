// rodar com: npx tsx scripts/testes/excecoes.test.ts
import assert from 'node:assert/strict';
import { resolveCancelReasons, DEFAULT_CANCEL_REASONS, operatorsOverThreshold, operatorTotalExceptions, type ExceptionOperatorRow } from '../../lib/excecoes';

assert.deepEqual(resolveCancelReasons(null), DEFAULT_CANCEL_REASONS);
assert.deepEqual(resolveCancelReasons({ cancel_reasons: [] }), DEFAULT_CANCEL_REASONS);
assert.deepEqual(resolveCancelReasons({ cancel_reasons: [' Quebrou ', '', 'Vencido'] }), ['Quebrou', 'Vencido']);

const rows: ExceptionOperatorRow[] = [
  { operator_name: 'A', counts: { item_cancelado: 12, taxa_editada: 1 }, values: {} },
  { operator_name: 'B', counts: { item_cancelado: 3 }, values: {} },
  { operator_name: 'C', counts: { item_cancelado: 10 }, values: {} },
];
assert.equal(operatorTotalExceptions(rows[0]), 13);
assert.deepEqual(operatorsOverThreshold(rows, 10).map((r) => r.operator_name), ['A', 'C']);
assert.equal(operatorsOverThreshold(rows, 50).length, 0);
console.log('excecoes: ok');
