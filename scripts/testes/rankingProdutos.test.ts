// rodar com: npx tsx scripts/testes/rankingProdutos.test.ts
// Mais e menos vendidos com filtro de categoria (Andrey, 20/10/2026: "dropdown nos mais vendidos e menos vendidos para
// selecionar por categorias/subcategorias").
import assert from 'node:assert/strict';
import { rankingDeProdutos, opcoesDoFiltro, filtroDoValor } from '../../lib/rankingProdutos';

const prod = (id: string, name: string, category_id: string | null, extra: any = {}) => ({ id, name, category_id, ...extra });
const item = (p: any, qty: number, extra: any = {}) => ({ product_id: p.id, product: p, quantity: qty, status: 'delivered', selected_options: [], ...extra });
const cerveja = prod('p1', 'Cerveja', 'c1');
const agua = prod('p2', 'Água', 'c1');
const coco = prod('p3', 'Coco', 'c2');
const orfao = prod('p4', 'Sem categoria', null);
const taxa = prod('p5', 'Taxa de Serviço', 'c3', { fee_type: 'percent' });
const moqueca = prod('p6', 'Moqueca', 'c4');
const vendas: any[] = [
  { order_items: [item(cerveja, 10), item(agua, 2), item(coco, 4), item(orfao, 7), item(taxa, 1), item(moqueca, 3), item(cerveja, 5, { status: 'canceled' })] },
  { order_items: [item(agua, 1), item(coco, 1)] },
];
const categorias: any[] = [
  { id: 'c1', name: 'Cervejas e Águas', order: 1, group_id: 'g1' },
  { id: 'c2', name: 'Sucos', order: 2, group_id: 'g1' },
  { id: 'c3', name: 'Taxas', order: 3, group_id: null },
  { id: 'c4', name: 'Pratos', order: 0, group_id: null },
];
const grupos: any[] = [{ id: 'g1', name: 'Bebidas', order: 0 }];

const todas = rankingDeProdutos(vendas, categorias, { tipo: 'todas' });
assert.deepEqual(todas.top.map((p) => [p.name, p.qty]), [['Cerveja', 10], ['Sem categoria', 7], ['Coco', 5], ['Água', 3], ['Moqueca', 3]], 'cancelado e taxa fora, órfão dentro');
assert.equal(todas.bottom.length, 0, 'com 5 produtos todos estão no top: menos vendidos não repete');

const c1 = rankingDeProdutos(vendas, categorias, { tipo: 'categoria', id: 'c1' });
assert.deepEqual(c1.top.map((p) => p.name), ['Cerveja', 'Água']);
const g1 = rankingDeProdutos(vendas, categorias, { tipo: 'grupo', id: 'g1' });
assert.deepEqual(g1.top.map((p) => p.name), ['Cerveja', 'Coco', 'Água']);
assert.ok(!g1.top.some((p) => p.name === 'Sem categoria'), 'órfão nunca entra num filtro');
assert.equal(rankingDeProdutos(vendas, categorias, { tipo: 'categoria', id: 'nada' }).top.length, 0);

// menos vendidos sem repetir o top, com mais de 5 produtos
const muitas: any[] = [{ order_items: Array.from({ length: 8 }, (_, i) => item(prod(`x${i}`, `P${i}`, 'c4'), i + 1)) }];
const r8 = rankingDeProdutos(muitas, categorias, { tipo: 'todas' });
assert.deepEqual(r8.top.map((p) => p.name), ['P7', 'P6', 'P5', 'P4', 'P3']);
assert.deepEqual(r8.bottom.map((p) => p.name), ['P0', 'P1', 'P2']);

// opções: Todas, grupo e as suas categorias, depois as soltas (por ordem)
assert.deepEqual(opcoesDoFiltro(categorias, grupos), [
  { value: 'todas', label: 'Todas as categorias' },
  { value: 'g:g1', label: 'Bebidas (todas)' },
  { value: 'c:c1', label: '— Cervejas e Águas' },
  { value: 'c:c2', label: '— Sucos' },
  { value: 'c:c4', label: 'Pratos' },
  { value: 'c:c3', label: 'Taxas' },
]);
assert.deepEqual(opcoesDoFiltro(categorias.filter((c) => !c.group_id), []).map((o) => o.value), ['todas', 'c:c4', 'c:c3'], 'loja sem grupos: só categorias');
assert.deepEqual(filtroDoValor('g:g1'), { tipo: 'grupo', id: 'g1' });
assert.deepEqual(filtroDoValor('c:c2'), { tipo: 'categoria', id: 'c2' });
assert.deepEqual(filtroDoValor('todas'), { tipo: 'todas' });
assert.deepEqual(filtroDoValor('lixo'), { tipo: 'todas' });
console.log('rankingProdutos: ok');
