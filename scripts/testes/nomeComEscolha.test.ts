// rodar com: npx tsx scripts/testes/nomeComEscolha.test.ts
import assert from 'node:assert/strict';
import { nomeComEscolha, getOrderItemDisplayName } from '../../lib/labels';

assert.deepEqual(nomeComEscolha('Acarajé ou Abará', [{ name: '8 bolinhos de acarajé' }]), { nome: '8 bolinhos de acarajé', adicionais: [] });
assert.equal(nomeComEscolha('Acarajé ou Abará', [{ name: '6 mini abarás' }]).nome, '6 mini abarás');
assert.equal(nomeComEscolha('Moqueca ou Ensopado de Camarão (200g)', [{ name: 'Moqueca' }]).nome, 'Moqueca de Camarão (200g)');
assert.equal(nomeComEscolha('Moqueca ou Ensopado de Pescada e Camarão', [{ name: 'Ensopado' }]).nome, 'Ensopado de Pescada e Camarão');
const r = nomeComEscolha('Moqueca ou Ensopado de Pescada (500g)', [{ name: 'Sem coentro' }, { name: 'Moqueca' }]);
assert.equal(r.nome, 'Moqueca de Pescada (500g)');
assert.deepEqual(r.adicionais, [{ name: 'Sem coentro' }]);
assert.equal(nomeComEscolha('Moqueca ou Ensopado de Camarão (200g)', []).nome, 'Moqueca ou Ensopado de Camarão (200g)');
assert.equal(nomeComEscolha('Pizza Tradicional', [{ name: 'Grande' }]).nome, 'Pizza Tradicional');
assert.equal(getOrderItemDisplayName({ product: { name: 'Acarajé ou Abará' }, selected_options: [{ name: '8 bolinhos de acarajé' }] }), '8 bolinhos de acarajé');
assert.equal(getOrderItemDisplayName({ product: { name: 'Pizza Tradicional' }, selected_options: [{ name: 'Grande' }, { name: 'Calabresa' }] }), 'Pizza Tradicional (Grande, Calabresa)');
console.log('nomeComEscolha: ok');
