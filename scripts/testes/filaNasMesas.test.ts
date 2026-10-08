// rodar com: npx tsx scripts/testes/filaNasMesas.test.ts
// Sem internet, a tela de mesas (cópia do aparelho) reflete o que está na fila (08/10/2026: mesa aberta voltava a "Livre").
import assert from 'node:assert/strict';
import { aplicarFilaNasMesas } from '../../lib/offline/pendingOrders';

const mesas = [{ id: 'm1', status: 'available' }, { id: 'm2', status: 'available' }, { id: 'm3', status: 'occupied', current_host_name: 'Ana' }];
const r = aplicarFilaNasMesas(mesas, [
  { type: 'open_table_manually', payload: { p_table_id: 'm1', p_host_name: 'Família Silva' } },
  { type: 'open_table_manually', payload: { p_table_id: 'm2', p_host_name: 'Rita', p_funcionario: 'Rita' } },
  { type: 'create_order', payload: { p_table_id: 'm2' } },
  { type: 'close_table_session', payload: { tableId: 'm3' } },
]);
assert.equal(r[0].status, 'occupied');
assert.equal(r[0].current_host_name, 'Família Silva');
assert.equal(r[1].status, 'occupied');
assert.equal((r[1] as any).funcionario, 'Rita');
assert.equal((r[1] as any).service_fee_removed, true);
assert.equal(r[2].status, 'available', 'conta fechada sem internet libera a mesa');
assert.equal(mesas[0].status, 'available', 'não mexe na lista original');
// pedido numa mesa livre (aberta pelo próprio pedido) ocupa a mesa
assert.equal(aplicarFilaNasMesas([{ id: 'x', status: 'available' }], [{ type: 'create_order', payload: { p_table_id: 'x' } }])[0].status, 'occupied');
console.log('filaNasMesas: ok');
