// rodar com: npx tsx scripts/testes/locaisPreparo.test.ts
import assert from 'node:assert/strict';
import { chaveLocal, listarLocais, statusLocal, type LocalPreparo } from '../../lib/locaisPreparo';

assert.equal(chaveLocal(null, 'kitchen'), 'kitchen');
assert.equal(chaveLocal('abc', 'kitchen'), 'setor:abc');

const setores = [{ id: 'p1', name: 'Pizzaria', base: 'kitchen' as const }];
assert.deepEqual(listarLocais(setores, { cozinha: true, bar: true }).map((l) => l.chave), ['kitchen', 'bar', 'setor:p1']);
assert.deepEqual(listarLocais(setores, { cozinha: false, bar: false }).map((l) => l.chave), ['setor:p1'], 'módulos desligados somem, setor fica');

const pizzaria: LocalPreparo = { chave: 'setor:p1', nome: 'Pizzaria', base: 'kitchen', setorId: 'p1' };
// Caso real da Donana (04/10): criou "pizzaria", 0 categorias, sem impressora, estoque integrado mas sem vínculo.
const donana = statusLocal({ local: pizzaria, impressoras: [], mapaEstoque: { kitchen: 7 }, categoriasDoLocal: 0, produtosDoLocal: 0 });
assert.equal(donana.recebePedidos, false);
assert.equal(donana.completo, false);
assert.deepEqual(donana.itens.map((i) => [i.id, i.estado]), [['categorias', 'falta'], ['impressora', 'aviso'], ['estoque', 'aviso']]);

const completo = statusLocal({ local: pizzaria, impressoras: [{ sector_id: 'p1', is_active: true }], mapaEstoque: { 'setor:p1': 9 }, categoriasDoLocal: 2, produtosDoLocal: 0 });
assert.equal(completo.completo, true);
assert.equal(completo.recebePedidos, true);

// impressora inativa não conta; sem mapa de estoque (loja sem integração) não gera item de estoque
const semEstoque = statusLocal({ local: pizzaria, impressoras: [{ sector_id: 'p1', is_active: false }], mapaEstoque: null, categoriasDoLocal: 0, produtosDoLocal: 1 });
assert.equal(semEstoque.itens.some((i) => i.id === 'estoque'), false);
assert.equal(semEstoque.itens.find((i) => i.id === 'impressora')!.estado, 'aviso');
assert.equal(semEstoque.recebePedidos, true, 'produto apontando para o local basta');

// estoque integrado e sem nenhum vínculo (nem da base): falta
assert.equal(statusLocal({ local: pizzaria, impressoras: [], mapaEstoque: {}, categoriasDoLocal: 1, produtosDoLocal: 0 }).itens.find((i) => i.id === 'estoque')!.estado, 'falta');

// Cozinha padrão: não exige categorias, impressora 'all' vale
const cozinha: LocalPreparo = { chave: 'kitchen', nome: 'Cozinha', base: 'kitchen', setorId: null };
const c = statusLocal({ local: cozinha, impressoras: [{ sector_id: null, is_active: true, destination: 'all' }], mapaEstoque: { kitchen: 3 }, categoriasDoLocal: 0, produtosDoLocal: 0 });
assert.equal(c.completo, true);
assert.equal(c.itens.some((i) => i.id === 'categorias'), false);
console.log('locaisPreparo: ok');
