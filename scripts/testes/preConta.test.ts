// rodar com: npx tsx scripts/testes/preConta.test.ts
import assert from 'node:assert/strict';
import { montarPreConta, chavePreConta } from '../../lib/preConta';

const store: any = { name: 'O Sertão', cnpj: '39.912.717/0001-45', config: { charge_service_fee: true, service_fee_rate: 0.1, printer_paper_width_mm: 80 } };
const table: any = { id: 't1', number: 8, service_fee_removed: false };
const orders: any[] = [
  { id: 'aaaaaaaa-1', table_id: 't1', order_items: [
    { id: 'i1', quantity: 2, price_at_time: 10, status: 'delivered', created_at: '2026-09-29T20:00:00Z', product: { name: 'Coca' }, notes: '[Ana] ' },
    { id: 'i2', quantity: 1, price_at_time: 50, status: 'canceled', created_at: '2026-09-29T20:01:00Z', product: { name: 'Pizza' } },
  ] },
  { id: 'bbbbbbbb-2', table_id: 't1', order_items: [{ id: 'i3', quantity: 1, price_at_time: 30, status: 'pending', created_at: '2026-09-29T20:05:00Z', product: { name: 'Pastel' } }] },
  { id: 'cccccccc-3', table_id: 'OUTRA', order_items: [{ id: 'i9', quantity: 1, price_at_time: 999, status: 'pending', created_at: '2026-09-29T20:05:00Z', product: { name: 'X' } }] },
];
const p = montarPreConta(store, table, orders)!;
assert.equal(p.label, 'MESA 8');
assert.equal(p.items.length, 2, 'cancelado e outra mesa ficam de fora');
assert.equal(p.subtotal, 50);
assert.equal(p.serviceFee.charged, true);
assert.equal(p.serviceFee.amount, 5);
assert.equal(p.total, 55);
assert.equal(montarPreConta(store, { ...table, service_fee_removed: true }, orders)!.total, 50, 'taxa removida da mesa');
assert.equal(montarPreConta(store, table, [])!, null, 'mesa sem item não imprime');

// mesma mesa + mesmos itens = mesma chave (caixa e garçom não imprimem 2x); item novo = chave nova
const k1 = chavePreConta('t1', orders);
assert.equal(k1, chavePreConta('t1', [...orders].reverse()), 'ordem não importa');
const mais = [...orders, { id: 'dddddddd-4', table_id: 't1', order_items: [{ id: 'i4', quantity: 1, price_at_time: 5, status: 'pending', created_at: '', product: { name: 'Água' } }] }];
assert.notEqual(k1, chavePreConta('t1', mais), 'item novo pede pré-conta nova');
assert.ok(k1.startsWith('pre-conta:t1:'));
// taxa editada pelo caixa (mesmo item, valor novo) pede pré-conta nova
const comTaxa = (v: number) => [...orders, { id: 'eeeeeeee-5', table_id: 't1', order_items: [{ id: 'i5', quantity: 1, price_at_time: v, status: 'delivered', created_at: '', product: { name: 'Taxa de Serviço (10%)', fee_type: 'percent', fee_percent: 10 } }] }];
assert.notEqual(chavePreConta('t1', comTaxa(8.57)), chavePreConta('t1', comTaxa(6)), 'taxa editada pede pré-conta nova');
const pc = montarPreConta(store, table, comTaxa(6))!;
assert.equal(pc.items.length, 3, 'item de taxa aparece na pré-conta');
assert.equal(pc.serviceFee.charged, false, 'com item de taxa o automático não soma');
assert.equal(pc.total, 56, 'total usa o valor editado da taxa (50 + 6)');
console.log('ok');
