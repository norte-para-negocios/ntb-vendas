// rodar com: npx tsx scripts/testes/redeLocal.test.ts
// Rede local entre os computadores da loja (08/10/2026): filas trocadas sem internet e ordem ao subir.
import assert from 'node:assert/strict';
import { juntarFilas, planejarSincronizacao, mesaDaAcao } from '../../lib/offline/rede';

const agora = 1_000_000;
const a = (id: string, type: string, mesa: string | null, t: number, extra: Record<string, unknown> = {}) =>
  ({ id, type, payload: mesa ? (type === 'close_table_session' ? { tableId: mesa } : { p_table_id: mesa }) : {}, createdAt: t, attempts: 0, ...extra }) as any;

// juntar: minha vence, sem repetir, sem o que já subiu, em ordem
const j = juntarFilas([a('m1', 'create_order', 'T1', 3)], [a('o1', 'open_table_manually', 'T1', 1, { origem: 'B' }), a('m1', 'create_order', 'T1', 3, { origem: 'B' }), a('o2', 'create_order', 'T2', 2)], new Set(['o2']));
assert.deepEqual(j.map((x) => x.id), ['o1', 'm1']);
assert.equal(mesaDaAcao(a('x', 'close_table_session', 'T9', 1)), 'T9');

// 1) Caixa (eu) fecha a mesa T1; o pedido da T1 foi feito ANTES no computador B, que está vivo -> eu espero.
const pedidoB = a('pB', 'create_order', 'T1', 10, { origem: 'B', origemVistaEm: agora - 5000 });
const fecharEu = a('fA', 'close_table_session', 'T1', 20);
let p = planejarSincronizacao([fecharEu], [pedidoB], new Set(), agora);
assert.deepEqual(p.subir.map((x) => x.id), [], 'fechamento espera o pedido do outro computador subir');
assert.deepEqual(p.esperando.map((x) => x.id), ['fA']);

// 2) B subiu o pedido (anunciou) -> agora eu fecho.
p = planejarSincronizacao([fecharEu], [pedidoB], new Set(['pB']), agora);
assert.deepEqual(p.subir.map((x) => x.id), ['fA']);

// 3) B sumiu há mais de 2 min -> eu subo o pedido dele (seguro: id próprio) e depois fecho, nessa ordem.
const pedidoBsumido = { ...pedidoB, origemVistaEm: agora - 3 * 60 * 1000 };
p = planejarSincronizacao([fecharEu], [pedidoBsumido], new Set(), agora);
assert.deepEqual(p.subir.map((x) => x.id), ['pB', 'fA']);

// 4) Ação NÃO segura de repetir de computador sumido (pagamento de B) nunca é subida por mim.
const pagamentoB = a('payB', 'close_table_session', 'T2', 5, { origem: 'B', origemVistaEm: agora - 10 * 60 * 1000 });
p = planejarSincronizacao([], [pagamentoB], new Set(), agora);
assert.deepEqual(p.subir.map((x) => x.id), []);

// 5) Mesas diferentes não se esperam; o que já subiu por outro sai da minha fila sem ir de novo.
const meuPedidoT3 = a('m3', 'create_order', 'T3', 30);
const jaSubido = a('m4', 'request_table_bill', 'T4', 31);
p = planejarSincronizacao([meuPedidoT3, jaSubido], [pedidoB], new Set(['m4']), agora);
assert.deepEqual(p.subir.map((x) => x.id), ['m3']);
assert.deepEqual(p.jaFeitas.map((x) => x.id), ['m4']);

// 6) Se uma ação minha da mesa espera, as minhas seguintes da MESMA mesa também esperam (ordem preservada).
const meuPedidoT1 = a('m5', 'create_order', 'T1', 15);
const minhaContaT1 = a('m6', 'request_table_bill', 'T1', 16);
p = planejarSincronizacao([meuPedidoT1, minhaContaT1], [pedidoB], new Set(), agora);
assert.deepEqual(p.subir.map((x) => x.id), []);
assert.deepEqual(p.esperando.map((x) => x.id), ['m5', 'm6']);
console.log('redeLocal: ok');
