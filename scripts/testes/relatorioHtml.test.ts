// rodar com: npx tsx scripts/testes/relatorioHtml.test.ts
import assert from 'node:assert/strict';
import { montarPainel } from '../../lib/reports/painelDia';
import { buildRelatorioHtml, buildTabelaHtml, esc } from '../../lib/reports/relatorioHtml';

const meta = { loja: 'Loja <b>X</b> & "Cia"', periodoLabel: '04/10/2026', geradoEm: new Date('2026-10-05T01:00:00Z'), geradoPor: 'QA' };
const resumo: any = { totals_by_method: { CASH: 100, CREDIT: 300 }, totals_by_card: { 'CREDIT|visa': 200, 'CREDIT|elo': 100 }, payments_count: 4, payments_total: 400, total_sangria: 0, total_suprimento: 0, service_fee_total: 40 };
const it = (n: string, q: number, p: number) => ({ id: n, quantity: q, price_at_time: p, status: 'delivered', product: { name: n, category_id: 'c1' } });
const venda = (id: string, h: string, itens: any[], op: string): any => ({ id, table_id: id, status: 'delivered', created_at: h, order_type: 'table', total: 100, payment_details: { operador_nome: op, methods: [{ method: 'CASH', amount: 100 }] }, order_items: itens });
const painel = montarPainel({ ...meta, excecoes: [], turnos: [{ operador: 'A', abertoEm: '', fechadoEm: null, fundo: 0, contado: null, resumo }],
  vendas: [venda('1', '2026-10-04T22:00:00Z', [it('Pizza <img>', 1, 100)], 'ANE'), venda('2', '2026-10-04T23:00:00Z', [it('Pizza <img>', 1, 50)], 'B')] }, () => 'Pizzas');

const html = buildRelatorioHtml(painel, meta);
assert.ok(!html.includes('<b>X</b>') && html.includes('Loja &lt;b&gt;X&lt;/b&gt; &amp; &quot;Cia&quot;'), 'loja escapada (Review Focus 3)');
assert.ok(!html.includes('<img>'), 'produto escapado');
assert.ok(html.includes('Norte Vendas') && html.includes('norteparanegocios.com.br'), 'propaganda pequena do Norte');
assert.ok(html.includes('#484DB5'), 'cor da marca');
assert.ok(html.includes('<svg'), 'símbolo do Norte');
assert.ok(html.includes('Hipercard crédito'), 'bandeira zerada listada (Review Focus 6)');
assert.ok(html.includes('Visa crédito') && html.includes('R$ 200,00'), 'total por bandeira de crédito');
assert.ok(html.includes('style="width:100%"'), 'a maior barra ocupa 100%');
assert.ok(!/NaN|undefined/.test(html), 'sem NaN/undefined');
assert.ok(html.includes('Ticket médio'), 'ticket médio');

const vazio = buildRelatorioHtml(montarPainel({ ...meta, excecoes: [], turnos: [], vendas: [] }), meta);
assert.ok(vazio.includes('Nenhuma venda neste período') && !/NaN|undefined/.test(vazio), 'dia vazio (Review Focus 2)');

const tab = buildTabelaHtml({ titulo: 'Análise por hora', colunas: [{ rotulo: 'Hora' }, { rotulo: 'Total', direita: true }], linhas: [['19h', 'R$ 100,00']], rodapeLinha: ['TOTAL', 'R$ 100,00'] }, meta);
assert.ok(tab.includes('Análise por hora') && tab.includes('R$ 100,00') && tab.includes('norteparanegocios.com.br'), 'tabela genérica com rodapé do Norte');
assert.equal(esc('<&>"\''), '&lt;&amp;&gt;&quot;&#39;');
console.log('relatorioHtml: ok');
