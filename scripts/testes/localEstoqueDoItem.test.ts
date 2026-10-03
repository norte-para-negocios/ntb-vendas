// rodar com: npx tsx scripts/testes/localEstoqueDoItem.test.ts
import assert from 'node:assert/strict';
import { localEstoqueDoItem, chaveDestinoEstoque } from '../../lib/setores';

const mapa = { kitchen: 5906914581, bar: 2354627389, 'setor:pz': 5906914974 };

// Setor próprio (ex.: Pizzaria) vence o destino base.
assert.equal(localEstoqueDoItem(mapa, 'pz', 'kitchen'), 5906914974);
// Sem setor: usa o destino base (Cozinha/Bar).
assert.equal(localEstoqueDoItem(mapa, null, 'bar'), 2354627389);
// Setor sem local escolhido: cai no destino base.
assert.equal(localEstoqueDoItem(mapa, 'outro', 'kitchen'), 5906914581);
// Nada configurado: null (o Estoque decide como antes).
assert.equal(localEstoqueDoItem({}, 'pz', 'kitchen'), null);
assert.equal(localEstoqueDoItem(mapa, null, null), null);

assert.equal(chaveDestinoEstoque('kitchen'), 'kitchen');
assert.equal(chaveDestinoEstoque('pz'), 'setor:pz');

console.log('localEstoqueDoItem: ok');
