// rodar com: npx tsx scripts/testes/resumoTurnoSemServidor.test.ts
// Fechamento de caixa sem servidor (13/10/2026): cópia guardada + pagamentos e sangrias da fila sem internet.
import assert from 'node:assert/strict';
import { resumoSemServidor } from '../../lib/offline/resumoTurno';

const shift = { id: 'T1', store_id: 'L', operator_user_id: 'U', opening_float: 100, opened_at: '2026-10-13T12:00:00Z', status: 'open', closed_at: null } as any;
const base = { shift, totals_by_method: { CASH: 50, PIX: 30 }, totals_by_brand: {}, totals_by_card: {}, payments_count: 2, payments_total: 80, total_sangria: 0, total_suprimento: 0, expected_cash: 150, closing_counted_cash: null, difference: null } as any;
const pg = (id: string, turno: string, methods: any[], type = 'close_table_session') => ({ type, payload: { tableId: 'M', paymentData: { cash_shift_id: turno, payment_id: id, methods } }, createdAt: 1 });

const r = resumoSemServidor(shift, base, [
  pg('p1', 'T1', [{ method: 'CASH', amount: 40 }, { method: 'CREDIT', amount: 60, brand: 'visa' }]),
  pg('p2', 'OUTRO', [{ method: 'CASH', amount: 999 }]),                                   // outro turno: fora
  pg('p3', 'T1', [{ method: 'PIX', amount: 25 }], 'registrar_pagamento_balcao'),
  pg('p3', 'T1', [{ method: 'PIX', amount: 25 }], 'close_counter_order'),                // entrega do mesmo pagamento: conta 1x
  pg('p4', 'T1', [{ method: 'COURTESY', amount: 20 }]),                                   // cortesia: não é faturamento
  { type: 'register_cash_movement', payload: { p_shift_id: 'T1', p_type: 'sangria', p_amount: 30 }, createdAt: 2 },
  { type: 'register_cash_movement', payload: { p_shift_id: 'T1', p_type: 'suprimento', p_amount: 10 }, createdAt: 3 },
  { type: 'create_order', payload: { p_table_id: 'M' }, createdAt: 4 },
]);
assert.equal(r.totals_by_method.CASH, 90);
assert.equal(r.totals_by_method.PIX, 55);
assert.equal(r.totals_by_method.CREDIT, 60);
assert.equal(r.totals_by_method.COURTESY, 20);
assert.equal(r.totals_by_brand.visa, 60);
assert.equal(r.payments_count, 4);            // 2 + p1 + p3
assert.equal(r.payments_total, 205);          // 80 + 100 + 25
assert.equal(r.expected_cash, 150 + 40 - 30 + 10);
assert.equal(r.total_sangria, 30);
assert.equal(r.total_suprimento, 10);
assert.equal(r.semServidor, true);
assert.equal(base.totals_by_method.CASH, 50, 'não altera a cópia guardada');

// sem cópia guardada: parte do fundo de troco
const s = resumoSemServidor(shift, null, [pg('p1', 'T1', [{ method: 'CASH', amount: 40 }])]);
assert.equal(s.expected_cash, 140);
assert.equal(s.payments_total, 40);
assert.equal(s.payments_count, 1);
console.log('resumoTurnoSemServidor: ok');
