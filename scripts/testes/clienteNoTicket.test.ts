// rodar com: npx tsx scripts/testes/clienteNoTicket.test.ts
// Papel da cozinha/bar: pedido da equipe na mesa sai só com a mesa (ODARA, 24/10/2026).
import assert from 'node:assert/strict';
import { clienteNoTicket } from '../../lib/labels';

assert.equal(clienteNoTicket({ notes: '[Talislane Silva]', added_by_role: 'garcom' }, 'table'), null);
assert.equal(clienteNoTicket({ notes: '[Herica] sem gelo', added_by_role: 'caixa' }, 'table'), null);
assert.equal(clienteNoTicket({ notes: '[JR]', added_by_role: null }, 'table'), null);
assert.equal(clienteNoTicket({ notes: '[Maria]', added_by_role: 'cliente' }, 'table'), 'Maria');
assert.equal(clienteNoTicket({ notes: '', added_by_role: 'cliente' }, 'table'), null);
assert.equal(clienteNoTicket({ notes: '[Joao]', added_by_role: 'garcom' }, 'counter', 'Joao'), 'Joao');
assert.equal(clienteNoTicket({ notes: '', added_by_role: null }, 'counter', 'Ana'), 'Ana');
console.log('clienteNoTicket: ok');
