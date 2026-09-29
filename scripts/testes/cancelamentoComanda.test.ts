// rodar com: npx tsx scripts/testes/cancelamentoComanda.test.ts
import assert from 'node:assert/strict';
import { buildKitchenTicketText } from '../../lib/print';

const base = { kind: 'COZINHA' as const, storeName: 'Loja', orderType: 'MESA', identifier: 'MESA 4', client: 'Ana', orderIdShort: 'abc12345' };

// comanda normal continua igual (sem marca de cancelamento)
const normal = buildKitchenTicketText({ ...base, items: [{ quantity: 2, productName: 'Pastel' }] });
assert.ok(!normal.includes('CANCEL'));
assert.ok(normal.includes('COZINHA'));

// comanda de cancelamento: título, aviso, itens marcados, quem cancelou e motivo
const canc = buildKitchenTicketText({
  ...base,
  items: [{ quantity: 2, productName: 'Pastel', observation: 'sem cebola' }, { quantity: 1, productName: 'Coxinha' }],
  cancelamento: { por: 'Ramon', motivo: 'cliente desistiu' },
});
assert.ok(canc.includes('CANCELAMENTO'), 'título');
assert.ok(canc.includes('COZINHA'), 'mantém o destino');
assert.ok(canc.includes('PEDIDO CANCELADO'), 'aviso grande');
assert.ok(canc.includes('CANCELAR: 2x Pastel'), 'item marcado');
assert.ok(canc.includes('CANCELAR: 1x Coxinha'), 'segundo item marcado');
assert.ok(canc.includes('Por: Ramon'), 'quem cancelou');
assert.ok(canc.includes('Motivo: cliente desistiu'), 'motivo');
assert.ok(canc.includes('MESA 4'), 'mesa');

// sem motivo: não imprime a linha de motivo
const semMotivo = buildKitchenTicketText({ ...base, items: [{ quantity: 1, productName: 'Coxinha' }], cancelamento: { por: 'Ramon' } });
assert.ok(!semMotivo.includes('Motivo:'));
console.log('ok');
