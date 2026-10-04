// rodar com: npx tsx scripts/testes/adminNav.test.ts
import assert from 'node:assert/strict';
import { AREAS, AJUSTES, ABAS_EM_BREVE, abasVisiveis, areasVisiveis, areaDaAba, abaInicial, corrigirAba, buscarAjustes, type NavCtx } from '../../lib/adminNav';

const dono: NavCtx = { user: { role: 'owner' }, podeVerExcecoes: true };
const garcom: NavCtx = { user: { role: 'waiter' }, podeVerExcecoes: false, can: () => false };
assert.equal(ABAS_EM_BREVE.size, 0, 'nenhuma aba escondida por "em breve"');

// as abas antigas continuam, cada uma em exatamente uma área
const antigas = ['dashboard', 'sales', 'shifts', 'relatorios', 'excecoes', 'impressao', 'locais', 'users', 'link', 'settings', 'cupons', 'precos', 'fiscal'];
const todas = AREAS.flatMap((a) => a.abas.map((b) => b.id));
antigas.forEach((id) => assert.equal(todas.filter((x) => x === id).length, 1, `${id} em exatamente uma área`));
assert.equal(new Set(todas).size, todas.length, 'ids de aba únicos');
assert.deepEqual(AREAS.map((a) => a.id), ['vendas', 'caixa', 'cardapio', 'equipe', 'config']);

assert.equal(abasVisiveis(dono).size, todas.length);
const g = abasVisiveis(garcom);
assert.equal(g.has('excecoes'), false);
assert.equal(g.has('saude'), false);
assert.equal(g.has('precos'), false);
assert.equal(g.has('dashboard'), true);

// área sem aba visível some
const nada: NavCtx = { user: { role: 'waiter' }, podeVerExcecoes: false, can: () => false };
assert.ok(areasVisiveis(nada).every((a) => a.abas.length > 0));
assert.equal(areasVisiveis(dono).length, 5);
// área cuja única aba some fica de fora
const soCardapioTrava: NavCtx = { user: { role: 'x' }, podeVerExcecoes: false, can: (a) => a !== 'ver_permissoes' };
assert.ok(areasVisiveis(soCardapioTrava).some((a) => a.id === 'equipe'), 'Equipe continua por causa de Pessoas');

assert.equal(areaDaAba('regras_caixa'), 'caixa');
assert.equal(areaDaAba('fiscal'), 'config');
assert.equal(areaDaAba('locais'), 'config');
assert.equal(abaInicial('vendas', dono), 'dashboard');
assert.equal(abaInicial('cardapio', garcom), 'cupons');

assert.equal(corrigirAba('excecoes', garcom), 'dashboard');
assert.equal(corrigirAba('sales', garcom), 'sales');

ABAS_EM_BREVE.add('saude');
assert.equal(abasVisiveis(dono).has('saude'), false);
ABAS_EM_BREVE.clear();

assert.equal(buscarAjustes('taxa')[0].id, 'taxa_servico');
assert.equal(buscarAjustes('TOLERANCIA')[0].id, 'tolerancia_caixa');
assert.equal(buscarAjustes('tolerância caixa')[0].id, 'tolerancia_caixa');
assert.ok(buscarAjustes('papel').some((a) => a.id === 'largura_papel'));
assert.deepEqual(buscarAjustes('   '), []);
assert.deepEqual(buscarAjustes('xyzqwerty'), []);
assert.equal(buscarAjustes('senha')[0].id, 'pedido_pede_senha');
assert.equal(buscarAjustes('notificações som')[0].id, 'notificacoes');

assert.equal(new Set(AJUSTES.map((a) => a.id)).size, AJUSTES.length);
AJUSTES.forEach((a) => assert.ok(todas.includes(a.aba), `aba ${a.aba} do ajuste ${a.id} existe`));
assert.equal(AJUSTES.find((a) => a.id === 'contagem_cega')!.aba, 'regras_caixa');
assert.equal(AJUSTES.length, 15);
console.log('adminNav: ok');
