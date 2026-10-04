// rodar com: npx tsx scripts/testes/producaoNav.test.ts
import assert from 'node:assert/strict';
import { contarPorLocal, usaMenuProducao, modoProducao, abaCorretaDeProducao, resumirKds, producaoAcessivel, locaisAcessiveis, abasProducao, somaContagens, itemPrecisaAcao } from '../../lib/producaoNav';
import { listarLocaisComTela } from '../../lib/locaisPreparo';

const it = (status: string, sector_id: string | null = null, tipo = 'table') => ({ status, sector_id, order: { order_type: tipo } });

assert.equal(itemPrecisaAcao(it('pending')), true);
assert.equal(itemPrecisaAcao(it('preparing')), false);
assert.equal(itemPrecisaAcao(it('accepted', null, 'counter')), true, 'balcão aceito precisa de ação');
assert.equal(itemPrecisaAcao(it('accepted', null, 'table')), false);

const conhecidos = new Set(['p1']);
const c = contarPorLocal({ kitchen: [it('pending'), it('pending', 'p1'), it('pending', 'p1'), it('preparing', 'p1'), it('pending', 'apagado')], bar: [it('pending')] }, conhecidos);
assert.deepEqual(c, { kitchen: 2, 'setor:p1': 2, bar: 1 }, 'setor apagado cai na Cozinha; preparando não conta');

const L = (cozinha: boolean, bar: boolean, setores: { id: string; name: string; base: 'kitchen' | 'bar' }[] = []) => listarLocaisComTela(setores, { cozinha, bar });
const pizz = [{ id: 'p1', name: 'Pizzaria', base: 'kitchen' as const }];
const comSetor = L(true, true, pizz);

// Regra 04/10 (dono): 2+ abas de KDS => item único "Produção" com abas, mesmo com setor sem categoria e mesmo sem setor nenhum.
assert.equal(usaMenuProducao(L(true, true)), true, 'Cozinha + Bar já são 2 abas');
assert.equal(usaMenuProducao(comSetor), true);
assert.equal(usaMenuProducao(L(true, false, pizz)), true, 'Cozinha + Pizzaria');
assert.equal(usaMenuProducao(L(false, true, pizz)), true, 'Bar + Pizzaria');
assert.equal(usaMenuProducao(L(true, false)), false, 'só Cozinha: 1 aba');
assert.equal(usaMenuProducao(L(false, false)), false);
assert.deepEqual(modoProducao(L(true, true)), { tipo: 'abas' });
assert.deepEqual(modoProducao(L(true, false)), { tipo: 'unico', tabId: 'kitchen', nome: 'Cozinha' });
assert.deepEqual(modoProducao(L(false, true)), { tipo: 'unico', tabId: 'bar', nome: 'Bar' });
assert.deepEqual(modoProducao(L(false, false, pizz)), { tipo: 'unico', tabId: 'producao', nome: 'Pizzaria' }, 'só um local criado: item com o nome dele');
assert.deepEqual(modoProducao(L(false, false)), { tipo: 'nenhum' });
// Garçom só com permissão de bar: a lista que chega aqui já é filtrada (locaisAcessiveis) -> 1 aba
assert.deepEqual(modoProducao(locaisAcessiveis(comSetor, new Set(['bar']))), { tipo: 'unico', tabId: 'bar', nome: 'Bar' });

// Redirecionamento de aba quando a loja ganha/perde abas
assert.equal(abaCorretaDeProducao({ tipo: 'abas' }, 'kitchen'), 'producao');
assert.equal(abaCorretaDeProducao({ tipo: 'abas' }, 'bar'), 'producao');
assert.equal(abaCorretaDeProducao({ tipo: 'abas' }, 'tables'), null);
assert.equal(abaCorretaDeProducao({ tipo: 'abas' }, 'producao'), null);
assert.equal(abaCorretaDeProducao({ tipo: 'unico', tabId: 'kitchen', nome: 'Cozinha' }, 'producao'), 'kitchen');
assert.equal(abaCorretaDeProducao({ tipo: 'unico', tabId: 'kitchen', nome: 'Cozinha' }, 'bar'), 'kitchen');
assert.equal(abaCorretaDeProducao({ tipo: 'unico', tabId: 'producao', nome: 'Pizzaria' }, 'kitchen'), 'producao');
assert.equal(abaCorretaDeProducao({ tipo: 'unico', tabId: 'kitchen', nome: 'Cozinha' }, 'kitchen'), null);
assert.equal(abaCorretaDeProducao({ tipo: 'nenhum' }, 'producao'), null, 'sem local nenhum: não redireciona (tela de sem permissão)');

assert.equal(producaoAcessivel(new Set(['tables'])), false);
assert.equal(producaoAcessivel(new Set(['bar'])), true);
// garçom só com permissão de bar não vê a Pizzaria (base kitchen)
assert.deepEqual(locaisAcessiveis(comSetor, new Set(['bar'])).map((l) => l.chave), ['bar']);

const abas = abasProducao(comSetor, c);
assert.deepEqual(abas.map((a) => [a.chave, a.count]), [['kitchen', 2], ['bar', 1], ['setor:p1', 2]]);
assert.equal(somaContagens(abas), 5);

// Contadores do cabeçalho da tela de Produção (mesmo padrão dos tiles de Pedidos do Dia)
const r = resumirKds([it('pending'), it('accepted', null, 'counter'), it('preparing'), it('preparing'), it('ready')], (i) => i.status === 'preparing');
assert.deepEqual(r, { novos: 2, preparando: 2, prontos: 1, atrasados: 2 });
assert.deepEqual(resumirKds([], () => false), { novos: 0, preparando: 0, prontos: 0, atrasados: 0 });
console.log('producaoNav: ok');
