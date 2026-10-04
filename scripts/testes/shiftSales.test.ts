// rodar com: npx tsx scripts/testes/shiftSales.test.ts
import assert from 'node:assert/strict';
import { salesOfShift } from '../../lib/reports/shiftSales';

const o = (id: string, pd: any) => ({ id, status: 'delivered', order_type: 'table', total: 10, created_at: '2026-10-03T22:00:00Z', payment_details: pd }) as any;
const orders = [
  o('a', { cash_shift_id: 'S1', methods: [{ method: 'PIX', amount: 10 }] }),
  o('b', { cash_shift_id: 'S1', methods: [{ method: 'CREDIT', amount: 10 }] }),
  o('c', { cash_shift_id: 'S2', methods: [{ method: 'PIX', amount: 10 }] }),
  o('d', null),                                  // Review Focus 2: sem turno
  o('e', { methods: [{ method: 'PIX', amount: 10 }] }), // sem cash_shift_id
];
assert.deepEqual(salesOfShift(orders, 'S1').map((x) => x.id), ['a', 'b']);
assert.deepEqual(salesOfShift(orders, 'S1', 'PIX').map((x) => x.id), ['a']);
assert.deepEqual(salesOfShift(orders, 'S9').map((x) => x.id), []);
assert.equal(salesOfShift(orders, '').length, 0, 'turno vazio não casa com pedido sem turno');
console.log('shiftSales: ok');
