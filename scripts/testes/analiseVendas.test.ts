// rodar com: npx tsx scripts/testes/analiseVendas.test.ts
import assert from 'node:assert/strict';
import { analisarVendas, contasDoRecorte, opcoesDosFiltros, serieComparada, FILTROS_VAZIOS } from '../../lib/reports/analiseVendas';

const cats = [{ id: 'beb', name: 'Bebidas', group_id: 'g1' }, { id: 'pra', name: 'Pratos', group_id: null }];
const it = (pid: string, nome: string, cat: string | null, q: number, preco: number, extra: Record<string, unknown> = {}) =>
  ({ product_id: pid, product: { name: nome, category_id: cat }, quantity: q, price_at_time: preco, status: 'pending', added_by_role: 'garcom', added_by_name: 'Talislane', ...extra });
const conta = (id: string, quando: string, itens: unknown[], metodos: { method: string; amount: number }[], extra: Record<string, unknown> = {}) =>
  ({ id, created_at: quando, status: 'delivered', order_type: 'table', tables: { number: 5 }, order_items: itens, payment_details: { payment_id: `p-${id}`, methods: metodos, operador_nome: 'Herica' }, ...extra }) as any;

const vendas = [
  // 24/10 13:10 Bahia
  conta('c1', '2026-10-24T16:10:00Z', [it('cer', 'Cerveja', 'beb', 4, 10), it('moq', 'Moqueca', 'pra', 1, 100), it('tx', 'Taxa', null, 1, 14, { product: { name: 'Taxa', category_id: null, fee_type: 'percent' } })], [{ method: 'PIX', amount: 154 }]),
  // cortesia total
  conta('c2', '2026-10-24T17:00:00Z', [it('cer', 'Cerveja', 'beb', 2, 10)], [{ method: 'COURTESY', amount: 20 }]),
  // item cancelado + balcão, 25/10
  conta('c3', '2026-10-25T13:30:00Z', [it('cer', 'Cerveja', 'beb', 1, 10, { added_by_role: 'cliente', added_by_name: null }), it('moq', 'Moqueca', 'pra', 1, 100, { status: 'canceled' })], [{ method: 'CREDIT', amount: 10 }], { order_type: 'counter' }),
  // produto sem categoria
  conta('c4', '2026-10-25T14:00:00Z', [it('xx', 'Produto Velho', null, 2, 5)], [{ method: 'CASH', amount: 10 }]),
];

const a = analisarVendas(vendas, cats, FILTROS_VAZIOS, { cobraTaxa: true, percentual: 0.1 });
assert.equal(a.kpis.faturamento, 174);
assert.equal(a.kpis.contas, 3); // cortesia total não é venda
assert.equal(a.kpis.ticket, 58);
assert.equal(a.kpis.itens, 8); // 4+1 (c1) + 1 (c3) + 2 (c4); taxa e cancelado fora
assert.equal(a.kpis.taxaServico, 14);
assert.deepEqual(a.kpis.cancelados, { qtd: 1, valor: 100 });
assert.deepEqual(a.produtos.map((p) => [p.nome, p.qtd, p.total, p.contas]), [['Cerveja', 5, 50, 2], ['Produto Velho', 2, 10, 1], ['Moqueca', 1, 100, 1]]);
assert.equal(a.produtos.find((p) => p.nome === 'Produto Velho')!.categoria, 'Sem categoria');
assert.deepEqual(a.categorias.map((c) => [c.nome, c.total]), [['Pratos', 100], ['Bebidas', 50], ['Sem categoria', 10]]);
assert.deepEqual(a.porDia.map((d) => [d.dia, d.total, d.contas]), [['2026-10-24', 154, 1], ['2026-10-25', 20, 2]]);
assert.deepEqual(a.porHora.map((h) => h.hora), [10, 11, 13]);
assert.deepEqual(a.formas.map((f) => [f.chave, f.total, f.contas]), [['PIX', 154, 1], ['CREDIT', 10, 1], ['CASH', 10, 1]]);
assert.deepEqual(a.mesas.map((m) => m.rotulo).sort(), ['Balcão', 'Mesa 5']);
assert.ok(a.equipe.some((e) => e.nome === 'Cliente pelo QR' && e.itens === 1));
assert.equal(a.contas.length, 3);
assert.equal(a.contas[0].id, 'c4'); // mais recente primeiro

// filtro de categoria: totais = soma dos itens filtrados
const b = analisarVendas(vendas, cats, { ...FILTROS_VAZIOS, categoria: { tipo: 'categoria', id: 'beb' } });
assert.equal(b.modoItens, true);
assert.equal(b.kpis.faturamento, 50);
assert.equal(b.kpis.contas, 2);
assert.deepEqual(b.produtos.map((p) => p.nome), ['Cerveja']);
const g = analisarVendas(vendas, cats, { ...FILTROS_VAZIOS, categoria: { tipo: 'grupo', id: 'g1' } });
assert.equal(g.kpis.faturamento, 50);

// forma, balcão e quem lançou
assert.equal(analisarVendas(vendas, cats, { ...FILTROS_VAZIOS, forma: 'PIX' }).kpis.faturamento, 154);
assert.equal(analisarVendas(vendas, cats, { ...FILTROS_VAZIOS, tipo: 'balcao' }).kpis.contas, 1);
assert.equal(analisarVendas(vendas, cats, { ...FILTROS_VAZIOS, operador: 'Cliente pelo QR' }).kpis.faturamento, 10);

// cliques
const cerv = a.produtos.find((p) => p.nome === 'Cerveja')!.chave;
assert.deepEqual(contasDoRecorte(vendas, cats, FILTROS_VAZIOS, { produto: cerv }).map((c) => [c.id, c.total]), [['c3', 10], ['c1', 40]]);
assert.deepEqual(contasDoRecorte(vendas, cats, FILTROS_VAZIOS, { dia: '2026-10-24' }).map((c) => c.id), ['c1']);
assert.deepEqual(contasDoRecorte(vendas, cats, FILTROS_VAZIOS, { forma: 'CASH' }).map((c) => c.formas), ['Dinheiro']);

// vazio
const v = analisarVendas([], cats);
assert.equal(v.kpis.faturamento, 0); assert.equal(v.kpis.ticket, 0); assert.equal(v.produtos.length, 0); assert.equal(v.contas.length, 0);

const op = opcoesDosFiltros(vendas);
assert.ok(op.pessoas.includes('Talislane') && op.pessoas.includes('Cliente pelo QR'));
assert.deepEqual(op.formas.map((f) => f.chave).sort(), ['CASH', 'CREDIT', 'PIX']);

// v2 (26/10): mapa de calor, mesa × balcão, picos, ticket por dia
assert.equal(a.mapaCalor.length, 7);
assert.equal(a.mapaCalor[6][13], 154); // sábado 24/10 13h
assert.equal(a.porTipo.balcao.total, 10);
assert.equal(a.porTipo.balcao.contas, 1);
assert.equal(a.porTipo.mesa.total, 164);
assert.equal(a.kpis.mesasAtendidas, 1);
assert.equal(a.kpis.maiorConta, 154);
assert.equal(a.kpis.horaPico, 13);
assert.equal(a.kpis.diaPico, '2026-10-24');
assert.equal(a.porDia[0].ticket, 154);
assert.equal(a.porDia[1].ticket, 10);
const vazia = analisarVendas([], cats);
assert.equal(vazia.kpis.horaPico, null);
assert.equal(vazia.kpis.diaPico, null);
assert.deepEqual(serieComparada([{ dia: '2026-10-24', total: 10 }, { dia: '2026-10-25', total: 20 }], [{ dia: '2026-10-22', total: 5 }]),
  [{ rotulo: '24/10', atual: 10, anterior: 5 }, { rotulo: '25/10', atual: 20, anterior: null }]);
console.log('analiseVendas: ok');
