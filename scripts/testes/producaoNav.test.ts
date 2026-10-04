// rodar com: npx tsx scripts/testes/producaoNav.test.ts
import assert from 'node:assert/strict';
import { contarPorLocal, usaMenuProducao, producaoAcessivel, locaisAcessiveis, abasProducao, somaContagens, itemPrecisaAcao } from '../../lib/producaoNav';
import { listarLocais } from '../../lib/locaisPreparo';

const it = (status: string, sector_id: string | null = null, tipo = 'table') => ({ status, sector_id, order: { order_type: tipo } });

assert.equal(itemPrecisaAcao(it('pending')), true);
assert.equal(itemPrecisaAcao(it('preparing')), false);
assert.equal(itemPrecisaAcao(it('accepted', null, 'counter')), true, 'balcão aceito precisa de ação');
assert.equal(itemPrecisaAcao(it('accepted', null, 'table')), false);

const conhecidos = new Set(['p1']);
const c = contarPorLocal({ kitchen: [it('pending'), it('pending', 'p1'), it('pending', 'p1'), it('preparing', 'p1'), it('pending', 'apagado')], bar: [it('pending')] }, conhecidos);
assert.deepEqual(c, { kitchen: 2, 'setor:p1': 2, bar: 1 }, 'setor apagado cai na Cozinha; preparando não conta');

const semSetor = listarLocais([], { cozinha: true, bar: true });
const comSetor = listarLocais([{ id: 'p1', name: 'Pizzaria', base: 'kitchen' }], { cozinha: true, bar: true });
assert.equal(usaMenuProducao(semSetor), false, 'loja de hoje continua com Cozinha e Bar separados');
assert.equal(usaMenuProducao(comSetor), true);

assert.equal(producaoAcessivel(new Set(['tables'])), false);
assert.equal(producaoAcessivel(new Set(['bar'])), true);
// garçom só com permissão de bar não vê a Pizzaria (base kitchen)
assert.deepEqual(locaisAcessiveis(comSetor, new Set(['bar'])).map((l) => l.chave), ['bar']);

const abas = abasProducao(comSetor, c);
assert.deepEqual(abas.map((a) => [a.chave, a.count]), [['kitchen', 2], ['bar', 1], ['setor:p1', 2]]);
assert.equal(somaContagens(abas), 5);
console.log('producaoNav: ok');
