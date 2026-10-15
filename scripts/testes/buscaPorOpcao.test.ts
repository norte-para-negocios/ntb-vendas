// rodar com: npx tsx scripts/testes/buscaPorOpcao.test.ts
// Busca do lançamento acha pelo sabor (15/10/2026): "calabresa" acha a pizza e marca o sabor no Sabor 1.
import assert from 'node:assert/strict';
import { buscarProdutosEOpcoes } from '../../lib/buscaPorOpcao';

const op = (id: string, name: string, order: number, available = true) => ({ id, name, order, available, price_delta: 0 }) as any;
const pizza = {
  id: 'pz', name: 'Pizza Tradicional', description: 'escolha o sabor', price: 40,
  option_groups: [
    { id: 'tam', name: 'Tamanho', order: 0, type: 'single', options: [op('p', 'Pequena', 0), op('g', 'Grande', 1)] },
    { id: 's2', name: 'Sabor 2 (opcional — meio a meio)', order: 2, type: 'single', options: [op('s2-x', 'Sem segundo sabor', 0), op('s2-cal', 'Calabresa', 1)] },
    { id: 's1', name: 'Sabor 1', order: 1, type: 'single', options: [op('s1-cal', 'Calabresa', 0), op('s1-fr', 'Frango', 1)] },
  ],
} as any;
const pastel = { id: 'pa', name: 'Pastel de Calabresa', price: 10, option_groups: [] } as any;
const esgotada = { id: 'ez', name: 'Pizza Doce', price: 40, option_groups: [{ id: 'd1', name: 'Sabor 1', order: 1, options: [op('d-cal', 'Calabresa', 0, false)] }] } as any;
const suco = { id: 'su', name: 'Suco', price: 8, option_groups: [{ id: 'sab', name: 'Sabor', order: 0, options: [op('lar', 'Laranja', 0)] }] } as any;

const r = buscarProdutosEOpcoes([pizza, pastel, esgotada, suco], 'CALABRÉSA');
assert.deepEqual(r.map((x) => x.product.id), ['pa', 'pz'], 'nome primeiro, depois por opção; opção indisponível não conta');
assert.equal(r[0].opcao, undefined);
assert.deepEqual(r[1].opcao, { groupId: 's1', groupName: 'Sabor 1', optionId: 's1-cal', optionName: 'Calabresa' }, 'marca no Sabor 1 (ordem do grupo), não no Sabor 2');
assert.deepEqual(buscarProdutosEOpcoes([pizza], 'tradicional').map((x) => [x.product.id, x.opcao]), [['pz', undefined]], 'achou pelo nome: nada marcado');
assert.deepEqual(buscarProdutosEOpcoes([suco], 'laranja')[0].opcao?.optionId, 'lar');
const meio = { id: 'mm', name: 'Pizza Meio a Meio', price: 40, option_groups: [{ id: 'a', name: 'Sabor 1', order: 1, options: [op('c1', 'Calabresa', 0), op('c2', 'Calabresa c/ Catupiry', 1), op('f', 'Frango', 2)] }] } as any;
assert.deepEqual(buscarProdutosEOpcoes([meio], 'calabresa').map((x) => x.opcao?.optionName), ['Calabresa', 'Calabresa c/ Catupiry'], 'um resultado por sabor que bate');
assert.deepEqual(buscarProdutosEOpcoes([pizza], '   '), []);
console.log('buscaPorOpcao: ok');
