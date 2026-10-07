// rodar com: npx tsx scripts/testes/locaisPreparoModo.test.ts
import assert from 'node:assert/strict';
import { resolveLocaisModo, modoDoLocal, fluxoDosLocais, ALL_ON } from '../../lib/storeModules';
import { listarLocaisComTela } from '../../lib/locaisPreparo';
import { applyModulesConfigFields } from '../../lib/api';

// Sem configuração: comportamento de hoje (loja com KDS = acompanhamento; direct_print = impressão).
assert.deepEqual(resolveLocaisModo({ config: {} }), {});
assert.deepEqual(resolveLocaisModo(null), {});
assert.equal(modoDoLocal({ config: {} }, 'kitchen'), 'acompanhamento');
assert.equal(modoDoLocal({ config: {} }, 'bar'), 'acompanhamento');
assert.equal(modoDoLocal({ config: {} }, 'setor:p1'), 'acompanhamento');
assert.equal(modoDoLocal({ config: { order_flow: 'direct_print' } }, 'kitchen'), 'impressao', 'Sertão: direct_print = impressão');
assert.equal(modoDoLocal({ config: { order_flow: 'direct_print' } }, 'setor:p1'), 'impressao');
assert.equal(modoDoLocal({ config: { modules: { ...ALL_ON, kitchen_kds: false } } }, 'kitchen'), 'impressao', 'bar sem cozinha: cozinha sem tela');
assert.equal(modoDoLocal({ config: { modules: { ...ALL_ON, kitchen_kds: false } } }, 'bar'), 'acompanhamento');

// Configurado vale sobre o derivado; valores inválidos são ignorados.
const cfg = { config: { order_flow: 'direct_print', locais_preparo_modo: { bar: 'acompanhamento', 'setor:p1': 'impressao', kitchen: 'xx', lixo: 1 } } };
assert.deepEqual(resolveLocaisModo(cfg), { bar: 'acompanhamento', 'setor:p1': 'impressao' });
assert.equal(modoDoLocal(cfg, 'bar'), 'acompanhamento');
assert.equal(modoDoLocal(cfg, 'kitchen'), 'impressao');
assert.deepEqual(resolveLocaisModo({ config: { locais_preparo_modo: ['bar'] } }), {}, 'array não vale');

assert.equal(fluxoDosLocais(['impressao', 'impressao']), 'direct_print');
assert.equal(fluxoDosLocais(['impressao', 'acompanhamento']), 'kds');
assert.equal(fluxoDosLocais([]), 'kds');

// Tela de acompanhamento só dos locais em 'acompanhamento'; sem mapa nada muda.
const setores = [{ id: 'p1', name: 'Pizzaria', base: 'kitchen' as const }];
const todos = { cozinha: true, bar: true };
assert.deepEqual(listarLocaisComTela(setores, todos).map((l) => l.chave), ['kitchen', 'bar', 'setor:p1']);
assert.deepEqual(listarLocaisComTela(setores, todos, {}).map((l) => l.chave), ['kitchen', 'bar', 'setor:p1']);
assert.deepEqual(listarLocaisComTela(setores, todos, { bar: 'impressao', 'setor:p1': 'impressao' }).map((l) => l.chave), ['kitchen']);

// applyModulesConfigFields: sem `locaisModo` o config fica byte-idêntico; com valores grava; vazio/null remove.
const base = { service_fee_rate: 0.1, locais_preparo_modo: { bar: 'impressao' } };
assert.deepEqual(applyModulesConfigFields({ service_fee_rate: 0.1 }, {}), { service_fee_rate: 0.1 }, 'loja que não mexe: idêntico');
assert.deepEqual(applyModulesConfigFields(base, {}).locais_preparo_modo, { bar: 'impressao' }, 'undefined preserva');
assert.deepEqual(applyModulesConfigFields({ service_fee_rate: 0.1 }, { locaisModo: { kitchen: 'impressao', x: 'lixo' as never } }).locais_preparo_modo, { kitchen: 'impressao' });
assert.equal('locais_preparo_modo' in applyModulesConfigFields(base, { locaisModo: null }), false);
assert.equal('locais_preparo_modo' in applyModulesConfigFields(base, { locaisModo: {} }), false);
console.log('locaisPreparoModo: ok');
