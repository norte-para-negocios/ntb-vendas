// rodar com: npx tsx scripts/testes/salesFilters.test.ts
import assert from 'node:assert/strict';
import { applySalesFilters, describeFilters, activeFilterCount, EMPTY_FILTERS } from '../../lib/reports/salesFilters';

const o = (id: string, extra: any = {}) => ({ id, status: 'delivered', order_type: 'table', total: 10, created_at: '2026-10-03T22:00:00Z', tables: { number: 8 }, order_items: [], ...extra });
const pago = (operador: string, methods: any[], emitir = true) => ({ operador_nome: operador, emitir_nota: emitir, methods });

const orders: any[] = [
  o('a', { payment_details: pago('Claudia', [{ method: 'CREDIT', brand: 'visa', amount: 10 }]) }),
  o('b', { payment_details: pago('Renato', [{ method: 'PIX', amount: 10 }], false), tables: { number: 11 } }),
  o('c', { status: 'canceled' }), // sem payment_details
  o('d', { payment_details: pago('Claudia', [{ method: 'DEBIT', brand: 'mastercard', amount: 10 }]), created_at: '2026-10-04T02:30:00Z' }), // 23:30 BRT do dia 03
];

assert.equal(applySalesFilters(orders, EMPTY_FILTERS).length, 4, 'sem filtro devolve tudo');
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, operator: 'Claudia' }).map((x) => x.id), ['a', 'd']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, method: 'PIX' }).map((x) => x.id), ['b']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, brand: 'visa' }).map((x) => x.id), ['a']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, table: '11' }).map((x) => x.id), ['b']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, status: 'canceled' }).map((x) => x.id), ['c']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, invoice: 'without' }).map((x) => x.id), ['b']);
// Review Focus 2: pedido sem payment_details não vira "Dinheiro" nem quebra
assert.equal(applySalesFilters(orders, { ...EMPTY_FILTERS, method: 'CASH' }).length, 0);
// Review Focus 5: 02:30Z = 23:30 em Bahia (UTC-3); faixa 23:00-23:59 pega só o 'd'
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, hourFrom: '23:00', hourTo: '23:59' }).map((x) => x.id), ['d']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, hourFrom: '19:00', hourTo: '19:30' }).map((x) => x.id), ['a', 'b', 'c']); // 22:00Z = 19:00 BRT
// combinação (AND)
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, operator: 'Claudia', method: 'DEBIT' }).map((x) => x.id), ['d']);
// chips
assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
assert.deepEqual(describeFilters({ ...EMPTY_FILTERS, operator: 'Claudia', method: 'CREDIT' }).map((c) => c.label), ['Operador: Claudia', 'Forma: Crédito']);
console.log('salesFilters: ok');
