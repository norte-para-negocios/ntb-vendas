// rodar com: npx tsx scripts/testes/regrasGarcomGerente.test.ts
// Regras do dono (04/10): R1 só gerente/caixa com `trocas` troca mesa, move item, cancela item e pedido;
// R2 garçom só tem o que foi liberado (permissions {} não vira acesso total); áreas sem permissão ficam com cadeado.
import assert from 'node:assert/strict';
import { roleCan } from '../../lib/rolePermissions';
import { hasTabPermission, computeAccessibleTabIds, resolveStoreModules } from '../../lib/storeModules';
import { abasBloqueadas, areasComBloqueadas, areasVisiveis } from '../../lib/adminNav';

const loja = { config: { modules: { caixa: true } } };
const garcomSertao = { role: 'waiter', permissions: { bar: false, menu: false, admin: false, caixa: false, tables: true, counter: false, kitchen: false, supervisiona_caixa: false } };
const garcomVazio = { role: 'waiter', permissions: {} };
const caixaTrocas = { role: 'cashier', permissions: { admin: true, caixa: true, tables: true, trocas: true, counter: true, supervisiona_caixa: true } };
const caixaSem = { role: 'cashier', permissions: { admin: true, caixa: true, tables: true, trocas: false, counter: true } };
const caixaSoTrocas = { role: 'cashier', permissions: { caixa: true, tables: true, trocas: true } };
const gerente = { role: 'manager', permissions: { bar: true, menu: true, admin: true, caixa: true, tables: true, counter: true, kitchen: true } };
const gerenteVazio = { role: 'manager', permissions: {} };

// R1
for (const a of ['cancelar_item', 'trocar_mesa', 'mover_item', 'cancelar_pedido'] as const) {
  assert.equal(roleCan(garcomSertao, loja, a), false, `garçom nunca: ${a}`);
  assert.equal(roleCan(garcomVazio, loja, a), false, `garçom {} nunca: ${a}`);
  assert.equal(roleCan(gerente, loja, a), true, `gerente: ${a}`);
  assert.equal(roleCan(caixaTrocas, loja, a), true, `caixa com trocas: ${a}`);
  assert.equal(roleCan(caixaSoTrocas, loja, a), true, `caixa com trocas (sem supervisão): ${a}`);
  assert.equal(roleCan(caixaSem, loja, a), a === 'cancelar_pedido' ? false : false, `caixa sem trocas: ${a}`);
}
// o garçom não ganha nada nem com a chave `trocas` ausente/false, e a matriz da loja só vale se o gerente ligar
assert.equal(roleCan({ role: 'waiter', permissions: { trocas: false } }, loja, 'trocar_mesa'), false);
assert.equal(roleCan(garcomSertao, { config: { role_permissions: { waiter: { trocar_mesa: true } } } }, 'trocar_mesa'), true);
assert.equal(roleCan({ role: 'open' }, { config: { role_permissions: { open: { trocar_mesa: true } } } }, 'trocar_mesa'), false);

// R2: garçom {} NÃO ganha acesso total; gerente {} segue permissivo como sempre
for (const t of ['caixa', 'counter', 'kitchen', 'bar', 'menu', 'admin']) {
  assert.equal(hasTabPermission(garcomVazio, t, loja), false, `garçom {} sem ${t}`);
  assert.equal(hasTabPermission(garcomSertao, t, loja), false, `garçom Sertão sem ${t}`);
}
assert.equal(hasTabPermission(garcomSertao, 'tables', loja), true);
assert.equal(hasTabPermission(garcomVazio, 'tables', loja), false);
assert.equal(hasTabPermission(gerenteVazio, 'admin', loja), true);
assert.equal(hasTabPermission({ role: 'cashier', permissions: {} }, 'admin', loja), false);
const mods = resolveStoreModules(loja);
assert.deepEqual([...computeAccessibleTabIds(mods, (t) => hasTabPermission(garcomSertao, t, loja))].sort(), ['tables']);

// Administração: abas sem permissão ficam bloqueadas (com cadeado), não somem
const ctxGarcom = { user: { role: 'waiter' }, podeVerExcecoes: false, can: () => false };
const bloq = abasBloqueadas(ctxGarcom);
assert.ok(bloq.has('excecoes') && bloq.has('permissoes') && bloq.has('saude') && bloq.has('precos'));
assert.ok(!bloq.has('dashboard'));
const todas = areasComBloqueadas().flatMap((a) => a.abas.map((b) => b.id));
assert.ok(todas.includes('excecoes') && todas.includes('permissoes'));
assert.ok(!areasVisiveis(ctxGarcom).flatMap((a) => a.abas.map((b) => b.id)).includes('permissoes'));
const ctxGerente = { user: { role: 'manager' }, podeVerExcecoes: true, can: () => true };
assert.equal(abasBloqueadas(ctxGerente).size, 0);
// garçom {} sem nenhuma aba NÃO cai na Administração (a rede de segurança é só de quem tem admin)
assert.deepEqual([...computeAccessibleTabIds(mods, (t) => hasTabPermission(garcomVazio, t, loja))], []);
assert.deepEqual([...computeAccessibleTabIds({ ...mods, tables: false, counter: false, kitchen_kds: false, bar_kds: false, caixa: false, menu: false }, (t) => hasTabPermission(gerente, t, loja))], ['admin']);
console.log('regrasGarcomGerente: ok');
