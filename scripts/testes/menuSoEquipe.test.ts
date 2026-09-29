// rodar com: npx tsx scripts/testes/menuSoEquipe.test.ts
import assert from 'node:assert/strict';
import { removerCategoriasSoEquipe } from '../../lib/menu';
const categories = [
  { id: 'c1', name: 'Pratos', staff_only: false },
  { id: 'c2', name: 'Embalagens', staff_only: true },
  { id: 'c3', name: 'Doces' },
] as any[];
const products = [
  { id: 'p1', category_id: 'c1' },
  { id: 'p2', category_id: 'c2' },
  { id: 'p3', category_id: 'c3' },
  { id: 'p4', category_id: null },
] as any[];
const r = removerCategoriasSoEquipe(categories, products);
assert.deepEqual(r.categories.map((c: any) => c.id), ['c1', 'c3'], 'categoria só da equipe some do cliente');
assert.deepEqual(r.products.map((p: any) => p.id), ['p1', 'p3', 'p4'], 'produtos dela somem; sem categoria continuam');
assert.equal(removerCategoriasSoEquipe([], []).categories.length, 0, 'vazio não quebra');
console.log('ok');
