// rodar com: npx tsx scripts/testes/pedidosDoDia.test.ts
import assert from 'node:assert/strict';
import { dataSeNaoHoje, filtrarLinhas, buscaCombina, contarPorLocal, resumir, agruparPorMesa, agruparPorHora, horaCurta, FILTROS_PADRAO, type LinhaPedido } from '../../lib/pedidosDoDia';

const L = (id: string, extra: Partial<LinhaPedido> = {}): LinhaPedido => ({
  id, orderId: `o-${id}`, time: '2026-10-04T22:10:00Z', tableNumber: 26, productName: 'Amstel 600ml', quantity: 1,
  destination: 'bar', localId: 'bar', closed: false, printed: true, addedByName: 'ANE', ...extra,
});

const rows: LinhaPedido[] = [
  L('1', { time: '2026-10-04T22:49:00Z', tableNumber: 290 }),
  L('2', { time: '2026-10-04T22:37:00Z', tableNumber: 306, productName: 'Pizza Meio a Meio (qualquer sabor)', addons: 'Grande, Portuguesa', localId: 'pizzaria', destination: 'kitchen', printed: false, addedByName: 'CLAUDIA' }),
  L('3', { time: '2026-10-04T22:37:30Z', tableNumber: 306, productName: 'Embalagem Pizza 40 cm', observation: 'viagem', localId: 'pizzaria', destination: 'kitchen', printed: false, addedByName: 'CLAUDIA' }),
  L('4', { time: '2026-10-04T22:12:00Z', tableNumber: 304, quantity: 2, productName: 'Refrigerante 350ml (Coca-Cola)', closed: true, printed: false, addedByName: null }), // fechada, sem nome (cliente/QR)
  L('5', { time: '2026-10-05T03:10:00Z', tableNumber: '?', productName: 'Água 350ml' }),                                              // 00h em Bahia
];
const f = (e: Partial<typeof FILTROS_PADRAO> = {}) => ({ ...FILTROS_PADRAO, ...e });

// hora em Bahia (UTC-3)
assert.equal(horaCurta('2026-10-04T22:10:00Z'), '19:10');

// busca: mesa, produto com acento, observação, quem lançou
assert.equal(buscaCombina(rows[0], 'mesa 290'), true);
assert.equal(buscaCombina(rows[1], 'portuguesa'), true);
assert.equal(buscaCombina(rows[3], 'agua'), false);
assert.equal(buscaCombina(rows[4], 'ÁGUA'), true, 'ignora acento e caixa');
assert.equal(buscaCombina(rows[2], 'viagem embalagem'), true, 'todas as palavras, qualquer ordem');
assert.equal(buscaCombina(rows[0], ''), true);

// filtros
assert.equal(filtrarLinhas(rows, f()).length, 5);
assert.deepEqual(filtrarLinhas(rows, f({ local: 'pizzaria' })).map((r) => r.id), ['2', '3']);
assert.deepEqual(filtrarLinhas(rows, f({ estado: 'sem_registro' })).map((r) => r.id), ['2', '3', '4']);
assert.deepEqual(filtrarLinhas(rows, f({ estado: 'impresso' })).map((r) => r.id), ['1', '5']);
assert.deepEqual(filtrarLinhas(rows, f({ soMeus: true, meuNome: 'CLAUDIA' })).map((r) => r.id), ['2', '3']);
assert.deepEqual(filtrarLinhas(rows, f({ soMeus: true, meuNome: 'ANE' })).map((r) => r.id), ['1', '5'], 'item sem nome nunca é "meu"');
assert.deepEqual(filtrarLinhas(rows, f({ soMeus: true, meuNome: 'NINGUEM' })), []);

// contagem por local ignora o filtro de local (chips mostram quanto tem em cada um)
assert.deepEqual(contarPorLocal(rows, f({ local: 'pizzaria' })), { todos: 5, bar: 3, pizzaria: 2 });

// resumo: falhas em destaque = sem registro de mesa ainda aberta
assert.deepEqual(resumir(rows), { linhas: 5, unidades: 6, impressos: 2, semRegistro: 3, semRegistroAbertas: 2, mesas: 4, unidadesImpressas: 2, unidadesSemRegistroAbertas: 2 });
assert.deepEqual(resumir([]), { linhas: 0, unidades: 0, impressos: 0, semRegistro: 0, semRegistroAbertas: 0, mesas: 0, unidadesImpressas: 0, unidadesSemRegistroAbertas: 0 });

// itens que não são de hoje levam a data; os de hoje não
const agoraT = new Date('2026-10-04T15:00:00Z'); // 12h em Bahia, 04/10
assert.equal(dataSeNaoHoje('2026-10-04T22:10:00Z', agoraT), null, 'hoje: só a hora');
assert.equal(dataSeNaoHoje('2026-10-01T01:49:00Z', agoraT), '30/09', 'mesa aberta desde ontem: data no fuso Bahia (01:49Z = 22:49 do dia 30)');

// balcão entra na lista, mas não conta como mesa e tem grupo próprio
const comBalcao = [...rows, L('b1', { tableNumber: 'Balcão', balcao: true, productName: 'Heineken', addedByName: null }), L('b2', { tableNumber: 'Balcão', balcao: true, productName: 'Heineken', quantity: 2 })];
assert.equal(resumir(comBalcao).mesas, 4, 'balcão não é mesa');
assert.equal(resumir(comBalcao).unidades, 6 + 3);
assert.ok(agruparPorMesa(comBalcao).some((g) => g.titulo === 'Balcão'));
assert.equal(buscaCombina(comBalcao[5], 'balcao'), true);

// agrupar por mesa: grupo mais recente primeiro; dentro do grupo, na ordem em que foi lançado
const porMesa = agruparPorMesa(rows);
assert.deepEqual(porMesa.map((g) => g.titulo), ['Mesa ?', 'Mesa 290', 'Mesa 306', 'Mesa 304'], 'número "?" vira grupo próprio');
const m306 = porMesa.find((g) => g.chave === '306')!;
assert.deepEqual(m306.linhas.map((r) => r.id), ['2', '3']);
assert.equal(m306.unidades, 2);
assert.equal(m306.semRegistroAbertas, 2);
assert.equal(m306.fechada, false);
assert.equal(porMesa.find((g) => g.chave === '304')!.fechada, true);

// agrupar por hora (Bahia): 03:10Z = 00h do dia seguinte; mais recente primeiro
const porHora = agruparPorHora(rows);
assert.deepEqual(porHora.map((g) => g.chave), ['00', '19'], 'meia-noite é "00", não "24"; grupo mais recente primeiro');
assert.deepEqual(porHora.map((g) => g.titulo), ['00h', '19h']);
assert.equal(porHora.find((g) => g.chave === '19')!.linhas.length, 4);
assert.equal(porHora.find((g) => g.chave === '00')!.linhas[0].id, '5');

console.log('pedidosDoDia: ok');
