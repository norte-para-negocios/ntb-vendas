// rodar com: npx tsx scripts/testes/modoEstoque.test.ts
// Modo de estoque da loja (migration 168): omie = hoje, proprio = Estoque próprio, nenhum = sem baixa.
import assert from 'node:assert/strict';
import { normalizarModo, modoDaLoja, ehProprio, ehOmie, usaEstoque, nomeSistemaEstoque, rotuloCodigo, rotuloCodigoCurto } from '../../lib/modoEstoque';

// Regressão: tudo que não é 'proprio' nem 'nenhum' é Omie, inclusive banco antigo (coluna ausente) e lixo.
for (const v of [undefined, null, '', 'omie', 'OMIE', 'xyz', 0, {}]) assert.equal(normalizarModo(v), 'omie');
assert.equal(normalizarModo('proprio'), 'proprio');
assert.equal(normalizarModo('nenhum'), 'nenhum');
assert.equal(modoDaLoja(undefined), 'omie');
assert.equal(modoDaLoja({}), 'omie');
assert.equal(modoDaLoja({ stock_mode: 'proprio' }), 'proprio');

assert.equal(ehOmie(undefined), true);
assert.equal(ehProprio('proprio'), true);
assert.equal(ehProprio('omie'), false);

// 'nenhum' não baixa; omie e proprio baixam.
assert.equal(usaEstoque('omie'), true);
assert.equal(usaEstoque('proprio'), true);
assert.equal(usaEstoque('nenhum'), false);
assert.equal(usaEstoque(undefined), true);

// Lojas fora do Omie nunca veem a palavra "Omie".
assert.equal(nomeSistemaEstoque('omie'), 'Omie');
for (const m of ['proprio', 'nenhum'] as const) {
  assert.doesNotMatch(nomeSistemaEstoque(m), /omie/i);
  assert.doesNotMatch(rotuloCodigo(m), /omie/i);
  assert.doesNotMatch(rotuloCodigoCurto(m), /omie/i);
}
assert.equal(rotuloCodigo('omie'), 'Código Omie');
console.log('modoEstoque: ok');
