// rodar com: npx tsx scripts/testes/categoryGroupsVazios.test.ts
import assert from 'node:assert/strict';
import { buildTopLevelItems } from '../../lib/categoryGroups';
import type { Category, CategoryGroup } from '../../types';

const cat = (id: string, order: number, group_id: string | null = null) => ({ id, store_id: 's', name: id, order, group_id }) as Category;
const grupo = (id: string, order: number) => ({ id, store_id: 's', name: id, order }) as CategoryGroup;
const chaves = (itens: ReturnType<typeof buildTopLevelItems>) => itens.map((i) => (i.kind === 'group' ? `g:${i.group.id}` : `c:${i.category.id}`));

const categorias = [cat('solta', 5), cat('agua', 1, 'bebidas')];
const grupos = [grupo('bebidas', 1), grupo('novo', 2), grupo('outro', 3)];

assert.deepEqual(chaves(buildTopLevelItems(categorias, grupos)), ['g:bebidas', 'c:solta'], 'cliente e garçom: grupo vazio continua escondido');
assert.deepEqual(chaves(buildTopLevelItems(categorias, grupos, { incluirGruposVazios: true })), ['g:bebidas', 'c:solta', 'g:novo', 'g:outro'], 'painel: grupo vazio aparece no fim, na ordem de criação');
const vazio = buildTopLevelItems([], [grupo('novo', 2)], { incluirGruposVazios: true })[0];
assert.ok(vazio.kind === 'group' && vazio.categories.length === 0, 'grupo vazio vem sem categorias');
console.log('categoryGroupsVazios: ok');
