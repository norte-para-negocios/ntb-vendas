// rodar com: npx tsx scripts/testes/groupSales.test.ts
import assert from 'node:assert/strict';
import { groupSales } from '../../lib/reports/groupSales';

const pd = (op: string, amount: number, method = 'PIX') => ({ operador_nome: op, methods: [{ method, amount }] });
const o = (id: string, iso: string, extra: any = {}) => ({ id, table_id: id, status: 'delivered', order_type: 'table', total: 100, created_at: iso, order_items: [], payment_details: pd('Claudia', 110), ...extra });

const orders: any[] = [
  o('a', '2026-10-03T22:10:00Z'),                                        // 19h BRT
  o('b', '2026-10-03T22:50:00Z', { payment_details: pd('Renato', 55) }),  // 19h BRT
  o('c', '2026-10-04T02:30:00Z', { payment_details: pd('Claudia', 220, 'CREDIT') }), // 23h BRT
  o('x', '2026-10-03T22:10:00Z', { status: 'canceled' }),                 // cancelada fora
];

const hora = groupSales(orders, 'hour');
assert.deepEqual(hora.map((r) => r.label), ['19h', '23h']);
assert.equal(hora[0].orders, 2);
assert.equal(hora[0].total, 165);
assert.equal(hora[0].ticket, 82.5);

const op = groupSales(orders, 'operator');
assert.deepEqual(op.map((r) => [r.label, r.total]), [['Claudia', 330], ['Renato', 55]]);

const forma = groupSales(orders, 'method');
assert.equal(forma.find((r) => r.label === 'Crédito')!.total, 220);

// Review Focus 1: conta com 2 pedidos e o MESMO pagamento conta uma vez
const dupla: any[] = [
  o('p1', '2026-10-03T22:10:00Z', { table_id: 't', payment_details: pd('Claudia', 487.08) }),
  o('p2', '2026-10-03T22:10:01Z', { table_id: 't', payment_details: pd('Claudia', 487.08) }),
];
const d = groupSales(dupla, 'operator');
assert.equal(d[0].total, 487.08);
assert.equal(d[0].orders, 1, 'a conta é uma venda só');

// categoria: soma pelos itens ativos
const cat = groupSales([o('k', '2026-10-03T22:10:00Z', { order_items: [
  { quantity: 2, price_at_time: 10, status: 'delivered', product: { category_id: 'c1' } },
  { quantity: 1, price_at_time: 30, status: 'canceled', product: { category_id: 'c1' } },
  { quantity: 1, price_at_time: 5, status: 'delivered', product: { category_id: null } },
] }) as any], 'category');
assert.equal(cat.find((r) => r.key === 'c1')!.total, 20, 'item cancelado não entra');
assert.equal(cat.find((r) => r.key === '_sem')!.label, 'Sem categoria');
console.log('groupSales: ok');
