// rodar com: npx tsx scripts/testes/modoAberto.test.ts
import assert from 'node:assert/strict';
import { hasTabPermission, canFinalizeBill, isTableInJurisdiction, computeAccessibleTabIds, resolveStoreModules } from '../../lib/storeModules';

const aberto = { role: 'open', permissions: {}, assigned_table_ids: ['x'] };
const loja = { config: {} };

// Só Mesas, mesmo com permissões permissivas (ausência de chave = liberado pros outros papéis).
for (const tab of ['caixa', 'counter', 'kitchen', 'bar', 'menu', 'admin']) assert.equal(hasTabPermission(aberto, tab, loja), false, tab);
assert.equal(hasTabPermission(aberto, 'tables', loja), true);
assert.deepEqual([...computeAccessibleTabIds(resolveStoreModules(loja), (t) => hasTabPermission(aberto, t, loja))], ['tables']);
// Conta/pagamento só com login, inclusive em loja sem módulo Caixa.
assert.equal(canFinalizeBill(aberto, loja), false);
// Enxerga e opera todas as mesas.
assert.equal(isTableInJurisdiction(aberto, 'qualquer'), true);
// Garçom continua como antes.
assert.equal(canFinalizeBill({ role: 'waiter', permissions: {} }, loja), true);
assert.equal(hasTabPermission({ role: 'waiter', permissions: {} }, 'menu', loja), true);

console.log('modoAberto: ok');
