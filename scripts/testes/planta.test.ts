// rodar com: npx tsx scripts/testes/planta.test.ts
import assert from 'node:assert/strict';
import { colunasSalvas, autoLayout, resolverPosicoes, colunasIdeais, larguraMinimaPx, snap, soltar, rotulosDeArea, areasDe, mesasNoIntervalo, dividirEmLotes, MARGEM, ASPECTO, type MesaPlanta, type Pos } from '../../lib/planta';

const mk = (n: number, extra: Partial<MesaPlanta> = {}): MesaPlanta => ({ id: `m${n}`, number: n, ...extra });
const lista = (q: number) => Array.from({ length: q }, (_, i) => mk(i + 1));
const dentro = (p: Pos) => p.x >= MARGEM && p.x <= 100 - MARGEM && p.y >= MARGEM && p.y <= 100 - MARGEM;
const distintas = (ps: Pos[]) => new Set(ps.map((p) => `${p.x}|${p.y}`)).size === ps.length;
const passoX = (cols: number) => (100 - 2 * MARGEM) / cols;

// 0 mesas
assert.deepEqual(autoLayout([]), { pos: [], cols: colunasIdeais(0) });
assert.equal(resolverPosicoes([]).naoSalvas, 0);

// 1 mesa: dentro das margens
const um = autoLayout(lista(1));
assert.equal(um.pos.length, 1);
assert.ok(dentro(um.pos[0]));

// 12 mesas: distintas, dentro, em grade de pelo menos 6 colunas
const doze = autoLayout(lista(12));
assert.equal(doze.pos.length, 12);
assert.ok(distintas(doze.pos) && doze.pos.every(dentro));
assert.ok(doze.cols >= 6);
assert.ok(doze.pos[0].x < doze.pos[1].x, 'mesa 1 antes da 2, da esquerda para a direita');

// Review Focus 1: ninguém salvou nada -> resolver devolve posição para todas, marcada como não salva
const r0 = resolverPosicoes(lista(12));
assert.equal(r0.posicoes.size, 12);
assert.equal(r0.naoSalvas, 12);
assert.ok([...r0.posicoes.values()].every((p) => p.salva === false));

// 500 mesas (Review Focus 3): cabem, distintas, dentro das margens, mapa com rolagem, rápido
const t0 = Date.now();
const q500 = autoLayout(lista(500));
const ms = Date.now() - t0;
assert.equal(q500.pos.length, 500);
assert.ok(distintas(q500.pos) && q500.pos.every(dentro));
assert.ok(larguraMinimaPx(q500.cols) >= 1500, `largura mínima ${larguraMinimaPx(q500.cols)}`);
assert.ok(ms < 1000, `demorou ${ms}ms`);
assert.ok(larguraMinimaPx(autoLayout(lista(12)).cols) < 600, 'poucas mesas não forçam rolagem');

// Review Focus 2: preservar posições salvas; só as que faltam entram, em lugar livre
const salvas = lista(10).map((m) => (m.number === 3 ? { ...m, floor_x: 50, floor_y: 50 } : m));
const parcial = autoLayout(salvas);
assert.ok(!parcial.pos.some((p) => p.id === 'm3'), 'a mesa salva não é movida');
assert.equal(parcial.pos.length, 9);
const px = passoX(parcial.cols);
assert.ok(parcial.pos.every((p) => Math.abs(p.x - 50) >= px * 0.75 || Math.abs(p.y - 50) >= px * ASPECTO * 0.75), 'ninguém cai em cima da mesa salva');
// tudo salvo -> nada a fazer; idempotente
const todasSalvas = lista(10).map((m, i) => ({ ...m, floor_x: 10 + i * 5, floor_y: 20 }));
assert.deepEqual(autoLayout(todasSalvas).pos, []);
assert.equal(resolverPosicoes(todasSalvas).naoSalvas, 0);
// soFaltantes:false reorganiza tudo e ignora o que estava salvo
assert.equal(autoLayout(todasSalvas, { soFaltantes: false }).pos.length, 10);
// mesa nova depois da planta pronta: as antigas não mudam
const comNova = [...todasSalvas, mk(11)];
const novaPos = autoLayout(comNova).pos;
assert.equal(novaPos.length, 1);
assert.equal(novaPos[0].id, 'm11');

// muitas posições salvas espalhadas: ainda cabem (sobe o nº de colunas se precisar)
const espalhadas = lista(30).map((m, i) => (i < 12 ? { ...m, floor_x: 8 + (i % 6) * 15, floor_y: 10 + Math.floor(i / 6) * 20 } : m));
const esp = autoLayout(espalhadas);
assert.equal(esp.pos.length, 18);
assert.ok(distintas(esp.pos) && esp.pos.every(dentro));

// Áreas: cada área começa numa linha nova
const comAreas = [1, 2, 3].map((n) => mk(n, { area: 'Salão' })).concat([4, 5, 6].map((n) => mk(n, { area: 'Varanda' })));
const ar = autoLayout(comAreas).pos;
const yDe = (ids: string[]) => ar.filter((p) => ids.includes(p.id)).map((p) => p.y);
assert.ok(Math.min(...yDe(['m4', 'm5', 'm6'])) > Math.max(...yDe(['m1', 'm2', 'm3'])), 'Varanda abaixo do Salão');
assert.deepEqual(areasDe(comAreas), ['Salão', 'Varanda']);
assert.deepEqual(areasDe(lista(3)), []);
const mapa = new Map(ar.map((p) => [p.id, { x: p.x, y: p.y }]));
const rot = rotulosDeArea(comAreas, mapa);
assert.equal(rot.length, 2);
assert.ok(rot.find((r) => r.area === 'Varanda')!.y > rot.find((r) => r.area === 'Salão')!.y);

// Encaixe: idempotente e dentro dos limites
const s1 = snap(33.3, 41.7, 6);
assert.deepEqual(snap(s1.x, s1.y, 6), s1);
const canto = snap(-20, 400, 6);
assert.ok(canto.x >= MARGEM && canto.y <= 100 - MARGEM);

// Review Focus 6: soltar em cima de outra mesa troca as duas
const atuais: Pos[] = [{ id: 'a', x: snap(0, 0, 6).x, y: snap(0, 0, 6).y }, { id: 'b', x: snap(60, 0, 6).x, y: snap(60, 0, 6).y }];
const trocou = soltar('a', { x: atuais[1].x + 0.5, y: atuais[1].y }, atuais, 6);
assert.equal(trocou.length, 2);
assert.deepEqual(trocou.find((p) => p.id === 'a'), { id: 'a', x: atuais[1].x, y: atuais[1].y });
assert.deepEqual(trocou.find((p) => p.id === 'b'), { id: 'b', x: atuais[0].x, y: atuais[0].y });
// soltar em lugar vazio move só a mesa
const livre = soltar('a', { x: 90, y: 60 }, atuais, 6);
assert.equal(livre.length, 1);

// Faixa de mesas (para atribuir área)
assert.deepEqual(mesasNoIntervalo(lista(10), 3, 5), ['m3', 'm4', 'm5']);
assert.deepEqual(mesasNoIntervalo(lista(10), 5, 3), ['m3', 'm4', 'm5'], 'de/ate invertidos');
assert.deepEqual(mesasNoIntervalo(lista(10), 20, 30), []);

// Lotes
assert.deepEqual(dividirEmLotes(Array.from({ length: 250 }, (_, i) => i), 100).map((l) => l.length), [100, 100, 50]);
assert.deepEqual(dividirEmLotes([], 100), []);
// Grade salva ao organizar com áreas (mais colunas que a ideal) continua sendo a grade do encaixe
const org = lista(25).map((m) => ({ ...m, area: m.number >= 23 ? 'Varanda' : 'Salão' }));
const orgPos = autoLayout(org, { soFaltantes: false });
const orgSalvas = org.map((m) => { const p = orgPos.pos.find((q) => q.id === m.id)!; return { ...m, floor_x: p.x, floor_y: p.y }; });
assert.equal(colunasSalvas(orgSalvas), orgPos.cols, 'infere as colunas da grade salva');
assert.equal(resolverPosicoes(orgSalvas).cols, orgPos.cols, 'resolver usa a grade salva');
assert.equal(colunasSalvas(lista(5)), null, 'sem posição salva: sem inferência');
assert.equal(colunasSalvas([mk(1, { floor_x: 37.3, floor_y: 14.1 })]), null, 'posição fora de grade: sem inferência');
const comSolta = orgSalvas.map((m, i) => (i === 0 ? { ...m, floor_x: 36.86, floor_y: 14.51 } : m));
assert.equal(colunasSalvas(comSolta), orgPos.cols, 'uma mesa solta não derruba a inferência');
console.log('planta: ok');
