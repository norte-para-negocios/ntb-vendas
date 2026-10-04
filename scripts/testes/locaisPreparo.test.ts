// rodar com: npx tsx scripts/testes/locaisPreparo.test.ts
import assert from 'node:assert/strict';
import { chaveLocal, listarLocais, statusLocal, atribuicaoCategoria, listarLocaisComTela, categoriasPorLocal, textoMoverCategoria, type LocalPreparo } from '../../lib/locaisPreparo';

assert.equal(chaveLocal(null, 'kitchen'), 'kitchen');
assert.equal(chaveLocal('abc', 'kitchen'), 'setor:abc');

const setores = [{ id: 'p1', name: 'Pizzaria', base: 'kitchen' as const }];
assert.deepEqual(listarLocais(setores).map((l) => l.chave), ['kitchen', 'bar', 'setor:p1'], 'Cozinha e Bar sempre listados, com ou sem módulo KDS');
assert.deepEqual(listarLocais([]).map((l) => l.chave), ['kitchen', 'bar']);
assert.deepEqual(listarLocaisComTela(setores, { cozinha: false, bar: false }).map((l) => l.chave), ['setor:p1'], 'telas de KDS seguem os módulos');

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

// Cozinha: impressora 'all' vale; sem categoria é só aviso (recebe o que não tem outro destino)
const cozinha: LocalPreparo = { chave: 'kitchen', nome: 'Cozinha', base: 'kitchen', setorId: null };
const c = statusLocal({ local: cozinha, impressoras: [{ sector_id: null, is_active: true, destination: 'all' }], mapaEstoque: { kitchen: 3 }, categoriasDoLocal: 1, produtosDoLocal: 0 });
assert.equal(c.completo, true);

// Cozinha/Bar também têm checklist de categorias (aviso se nenhuma, contagem se houver)
const semCat = statusLocal({ local: cozinha, impressoras: [], mapaEstoque: null, categoriasDoLocal: 0, produtosDoLocal: 0 });
assert.equal(semCat.recebePedidos, true);
assert.deepEqual(semCat.itens.find((i) => i.id === 'categorias')!.estado, 'aviso');
const comCat = statusLocal({ local: cozinha, impressoras: [], mapaEstoque: null, categoriasDoLocal: 3, produtosDoLocal: 0 });
assert.equal(comCat.itens.find((i) => i.id === 'categorias')!.texto, '3 categoria(s) enviam pedidos para cá.');
assert.equal(comCat.recebePedidos, true);

// Atribuição de categoria: exatamente um local
const setorIds = new Set(['p1']);
const prod = (category_id: string, destination: 'kitchen' | 'bar' | null, sector_id: string | null = null) => ({ category_id, destination, sector_id });
assert.deepEqual(atribuicaoCategoria({ id: 'c1', sector_id: 'p1' }, [prod('c1', 'bar')], setorIds), { chave: 'setor:p1', misto: false, cozinha: 0, bar: 1, total: 1 }, 'sector_id manda');
assert.equal(atribuicaoCategoria({ id: 'c1', sector_id: 'sumiu' }, [prod('c1', 'bar')], setorIds).chave, 'bar', 'setor inexistente cai nos produtos');
assert.equal(atribuicaoCategoria({ id: 'c1' }, [prod('c1', null), prod('c1', 'kitchen')], setorIds).chave, 'kitchen', 'null conta como Cozinha');
assert.equal(atribuicaoCategoria({ id: 'c1' }, [prod('c1', 'bar'), prod('c1', 'bar')], setorIds).chave, 'bar');
assert.equal(atribuicaoCategoria({ id: 'c1' }, [], setorIds).chave, 'kitchen', 'categoria vazia fica na Cozinha');
assert.equal(atribuicaoCategoria({ id: 'c1' }, [prod('c1', 'bar', 'p1'), prod('c1', 'kitchen')], setorIds).bar, 0, 'produto com setor próprio não conta');
const mista = atribuicaoCategoria({ id: 'c1' }, [prod('c1', 'bar'), prod('c1', 'bar'), prod('c1', 'kitchen'), prod('c2', 'bar')], setorIds);
assert.deepEqual(mista, { chave: 'bar', misto: true, cozinha: 1, bar: 2, total: 3 }, 'mista: maioria + marca misto');
assert.equal(atribuicaoCategoria({ id: 'c1' }, [prod('c1', 'bar'), prod('c1', 'kitchen')], setorIds).chave, 'kitchen', 'empate: Cozinha');

const mapa = categoriasPorLocal([{ id: 'c1' }, { id: 'c2', sector_id: 'p1' }, { id: 'c3' }], [prod('c3', 'bar')], setores);
assert.deepEqual(mapa.get('kitchen')!.map((x) => x.cat.id), ['c1']);
assert.deepEqual(mapa.get('bar')!.map((x) => x.cat.id), ['c3']);
assert.deepEqual(mapa.get('setor:p1')!.map((x) => x.cat.id), ['c2']);
const todas = [...mapa.values()].flat().map((x) => x.cat.id).sort();
assert.deepEqual(todas, ['c1', 'c2', 'c3'], 'cada categoria em exatamente um local');

assert.equal(textoMoverCategoria('Bebidas', 'Bar', 4), 'Os 4 produtos de Bebidas passam a ir para Bar.');
assert.equal(textoMoverCategoria('Bebidas', 'Bar', 1), 'O produto de Bebidas passa a ir para Bar.');
assert.equal(textoMoverCategoria('Bebidas', 'Bar', 0), 'Bebidas não tem produtos ainda; ela passa a ir para Bar.');

// Nenhum texto do checklist fala em "base" (jargão interno)
const locaisTodos: LocalPreparo[] = [cozinha, { chave: 'bar', nome: 'Bar', base: 'bar', setorId: null }, pizzaria, { chave: 'setor:b', nome: 'Churrasqueira', base: 'bar', setorId: 'b' }];
for (const l of locaisTodos) {
  for (const mapaE of [null, {}, { kitchen: 1, bar: 2 }] as (Record<string, number> | null)[]) {
    for (const nCat of [0, 2]) {
      const st = statusLocal({ local: l, impressoras: [], mapaEstoque: mapaE, categoriasDoLocal: nCat, produtosDoLocal: 0 });
      for (const i of st.itens) assert.ok(!/\bbase\b/i.test(i.texto), `texto com "base": ${i.texto}`);
    }
  }
}
assert.equal(statusLocal({ local: pizzaria, impressoras: [], mapaEstoque: null, categoriasDoLocal: 1, produtosDoLocal: 0 }).itens.find((i) => i.id === 'impressora')!.texto, 'Sem impressora própria: o pedido sai na impressora padrão da Cozinha.');
console.log('locaisPreparo: ok');
