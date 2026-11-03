import assert from 'node:assert/strict';
import { planejarNovos } from '../../lib/produtosNovosOmie';

// 03/11/2026 (Ramon): produto novo cadastrado no Omie tem que aparecer sozinho no Norte Vendas.
const categorias = [
  { id: 'c-sob', name: 'Sobremesas' },
  { id: 'c-cer', name: 'Cervejas' },
  { id: 'c-sem', name: 'Sem Álcool' },
];
const produtos = [
  { omie_codigo: '90405', name: 'Heineken 330ml', category_id: 'c-cer' },
  { omie_codigo: '90386', name: 'Heineken 600ml', category_id: 'c-cer' },
  { omie_codigo: '90550', name: 'Heineken Zero 330ml', category_id: 'c-sem' },
  { omie_codigo: '90700', name: 'Pudim', category_id: 'c-sob' },
  { omie_codigo: null, name: 'Pasta ao Molho Branco', category_id: null },
];

// Categoria aprendida dos irmãos da mesma família do Omie (a mais usada entre eles).
let r = planejarNovos([{ omieCodigo: '91007', nome: 'Long Heineken Ultimate 330 ML', preco: 16.9, familia: 'GELADAS COM ALCOOL', irmaos: ['90405', '90386', '90550'] }], produtos, categorias);
assert.deepEqual(r.criar, [{ omieCodigo: '91007', nome: 'Long Heineken Ultimate 330 ML', preco: 16.9, categoryId: 'c-cer' }]);

// Sem irmão no cardápio: categoria com o mesmo nome da família (sem acento/caixa). Preço de 1 centavo é de propósito (brinde de aniversário).
r = planejarNovos([{ omieCodigo: '98165', nome: 'Mousse de Coco (aniversário)', preco: 0.01, familia: 'SOBREMESAS', irmaos: [] }], produtos, categorias);
assert.deepEqual(r.criar, [{ omieCodigo: '98165', nome: 'Mousse de Coco (aniversário)', preco: 0.01, categoryId: 'c-sob' }]);
r = planejarNovos([{ omieCodigo: '91010', nome: 'Água Tônica', preco: 8, familia: 'sem alcool', irmaos: [] }], produtos, categorias);
assert.equal(r.criar[0].categoryId, 'c-sem');

// Nenhuma categoria encontrada: cria sem categoria (o lojista escolhe depois).
r = planejarNovos([{ omieCodigo: '91011', nome: 'Drink X', preco: 30, familia: 'DRINKS', irmaos: ['99999'] }], produtos, categorias);
assert.deepEqual(r.criar, [{ omieCodigo: '91011', nome: 'Drink X', preco: 30, categoryId: null }]);

// Nunca duplica: já ligado pelo código, mesmo nome sem código, repetido no lote, ou sem preço.
r = planejarNovos([
  { omieCodigo: '90405', nome: 'Heineken 330ml', preco: 12, familia: 'GELADAS COM ALCOOL' },
  { omieCodigo: '91020', nome: '  pasta ao molho BRANCO ', preco: 59.9, familia: 'MASSAS' },
  { omieCodigo: '91021', nome: 'Bolo', preco: 10, familia: 'SOBREMESAS' },
  { omieCodigo: '91021', nome: 'Bolo', preco: 10, familia: 'SOBREMESAS' },
  { omieCodigo: '91022', nome: 'Brinde', preco: 0, familia: 'SOBREMESAS' },
], produtos, categorias);
assert.deepEqual(r.criar.map((c) => c.omieCodigo), ['91021']);
assert.deepEqual(r.pulados, [
  { omieCodigo: '90405', motivo: 'ja_existe' },
  { omieCodigo: '91020', motivo: 'mesmo_nome' },
  { omieCodigo: '91021', motivo: 'ja_existe' },
  { omieCodigo: '91022', motivo: 'sem_preco' },
]);

console.log('ok produtosNovosOmie');
