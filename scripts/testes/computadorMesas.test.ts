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

import { lerComputadorMesas, salvarComputadorMesas, migrarChaveAntiga, rotuloBotaoMesas } from '../../lib/computadorMesas';

async function main() {

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

const nome = (n: string | null | undefined) => async () => n;

// 1. PC do salão (está na tela de Mesas) atualiza: fica preso à loja dele, sem ninguém configurar.
mem.set('ntb_mesas_loja', 's1');
mem.set('ntb_store_session', JSON.stringify({ aberto: true, storeId: 's1' }));
let r = await migrarChaveAntiga(nome('O Sertão Vai Virar Mar'));
assert.equal(r?.storeId, 's1');
assert.equal(r?.storeName, 'O Sertão Vai Virar Mar');
assert.equal(r?.definidoPor, 'atualização');
assert.equal(mem.has('ntb_mesas_loja'), false, 'chave antiga some');
assert.deepEqual(lerComputadorMesas(), r);
mem.clear();

// 2. A loja da sessão de Mesas vence a chave antiga (último login pode ter sido de outra loja).
mem.set('ntb_mesas_loja', 'o1');
mem.set('ntb_store_session', JSON.stringify({ aberto: true, storeId: 's1' }));
r = await migrarChaveAntiga(async (id) => (id === 's1' ? 'Sertão' : 'ODARA'));
assert.equal(r?.storeId, 's1');
mem.clear();

// 3. PC do caixa (sessão de uma pessoa): o botão some.
mem.set('ntb_mesas_loja', 's1');
mem.set('ntb_store_session', JSON.stringify({ userId: 'u1', storeId: 's1' }));
r = await migrarChaveAntiga(nome('Sertão'));
assert.equal(r, null);
assert.equal(mem.has('ntb_mesas_loja'), false);
assert.equal(lerComputadorMesas(), null);
mem.clear();

// 4. Já configurado: login antigo não sobrescreve.
salvarComputadorMesas({ storeId: 'o1', storeName: 'ODARA', definidoPor: 'Ramon', em: 'x' });
mem.set('ntb_mesas_loja', 's1');
mem.set('ntb_store_session', JSON.stringify({ aberto: true, storeId: 's1' }));
r = await migrarChaveAntiga(nome('Sertão'));
assert.equal(r?.storeId, 'o1');
assert.equal(mem.has('ntb_mesas_loja'), false);
mem.clear();

// 5. Loja desativada: não prende.
mem.set('ntb_store_session', JSON.stringify({ aberto: true, storeId: 's1' }));
r = await migrarChaveAntiga(nome(null));
assert.equal(r, null);
assert.equal(lerComputadorMesas(), null);
mem.clear();

// 6. Sem internet na atualização: prende assim mesmo (salão não pode parar), nome vem depois.
mem.set('ntb_store_session', JSON.stringify({ aberto: true, storeId: 's1' }));
r = await migrarChaveAntiga(nome(undefined));
assert.equal(r?.storeId, 's1');
assert.equal(r?.storeName, '');
mem.clear();

// 7. Nada antigo: nada muda.
assert.equal(await migrarChaveAntiga(nome('x')), null);

// rótulo
assert.equal(rotuloBotaoMesas({ storeId: 'o1', storeName: 'ODARA BEACH', definidoPor: '', em: '' }), 'Mesas · ODARA BEACH');
assert.equal(rotuloBotaoMesas({ storeId: 'o1', storeName: '', definidoPor: '', em: '' }), 'Mesas');
console.log('computadorMesas: ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
