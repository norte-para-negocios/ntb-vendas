// rodar com: npx tsx scripts/testes/computadorMesas.test.ts
// Computador de mesas preso a uma loja (21/10/2026, pedido do dono: "não faz sentido ter o botão em todos os acessos...
// como a gente vai diferenciar de qual restaurante é?").
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as any).window = globalThis;
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
};

import { lerComputadorMesas, salvarComputadorMesas, migrarChaveAntiga, rotuloBotaoMesas, chaveAntiga } from '../../lib/computadorMesas';

function main() {

// ler / salvar
assert.equal(lerComputadorMesas(), null);
const c = { storeId: 'o1', storeName: 'ODARA BEACH', definidoPor: 'Ramon', em: '2026-10-21T18:00:00.000Z' };
salvarComputadorMesas(c);
assert.deepEqual(lerComputadorMesas(), c);
salvarComputadorMesas(null);
assert.equal(lerComputadorMesas(), null);
mem.set('ntb-computador-mesas', '{quebrado');
assert.equal(lerComputadorMesas(), null, 'JSON quebrado = sem configuração');
mem.set('ntb-computador-mesas', JSON.stringify({ storeName: 'x' }));
assert.equal(lerComputadorMesas(), null, 'sem storeId = sem configuração');
mem.clear();

// 1. PC do salão (sessão de Mesas restaurada) atualiza: fica preso à loja dele, sem ninguém configurar.
mem.set('ntb_mesas_loja', 's1');
let r = migrarChaveAntiga({ storeId: 's1', storeName: 'O Sertão Vai Virar Mar' });
assert.equal(r?.storeId, 's1');
assert.equal(r?.storeName, 'O Sertão Vai Virar Mar');
assert.equal(r?.definidoPor, 'atualização');
assert.equal(chaveAntiga(), null, 'chave antiga some');
assert.deepEqual(lerComputadorMesas(), r);
mem.clear();

// 2. PC do caixa (entrou uma pessoa): o botão some.
mem.set('ntb_mesas_loja', 's1');
r = migrarChaveAntiga(null);
assert.equal(r, null);
assert.equal(chaveAntiga(), null);
assert.equal(lerComputadorMesas(), null);
mem.clear();

// 3. Já configurado: a chave antiga não sobrescreve.
salvarComputadorMesas({ storeId: 'o1', storeName: 'ODARA', definidoPor: 'Ramon', em: 'x' });
mem.set('ntb_mesas_loja', 's1');
r = migrarChaveAntiga({ storeId: 's1', storeName: 'Sertão' });
assert.equal(r?.storeId, 'o1');
assert.equal(chaveAntiga(), null);
mem.clear();

// 4. Já migrado (sem chave antiga): garçom logar num PC sem marcação NÃO marca; e não desmarca o marcado.
assert.equal(migrarChaveAntiga({ storeId: 's1', storeName: 'Sertão' }), null);
assert.equal(lerComputadorMesas(), null);
salvarComputadorMesas({ storeId: 'o1', storeName: 'ODARA', definidoPor: 'Ramon', em: 'x' });
assert.equal(migrarChaveAntiga(null)?.storeId, 'o1');
mem.clear();

// rótulo
assert.equal(rotuloBotaoMesas({ storeId: 'o1', storeName: 'ODARA BEACH', definidoPor: '', em: '' }), 'Mesas · ODARA BEACH');
assert.equal(rotuloBotaoMesas({ storeId: 'o1', storeName: '', definidoPor: '', em: '' }), 'Mesas');
console.log('computadorMesas: ok');
}
main();
