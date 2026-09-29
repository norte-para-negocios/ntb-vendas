// rodar com: npx tsx scripts/testes/setorDoItem.test.ts
import assert from 'node:assert/strict';
import { setorDoItem } from '../../lib/setores';
const cat = { c1: 'PIZZARIA', c2: null } as Record<string, string | null>;
assert.equal(setorDoItem({ sector_id: 'X', category_id: 'c1' }, cat), 'X', 'setor do produto vence');
assert.equal(setorDoItem({ sector_id: null, category_id: 'c1' }, cat), 'PIZZARIA', 'pizza herda da categoria');
assert.equal(setorDoItem({ sector_id: null, category_id: 'c1', ignore_category_sector: true }, cat), null, 'produto pode ignorar a categoria');
assert.equal(setorDoItem({ sector_id: null, category_id: 'c2' }, cat), null, 'categoria sem setor');
assert.equal(setorDoItem(undefined, cat), null, 'produto indisponível');
console.log('ok');
