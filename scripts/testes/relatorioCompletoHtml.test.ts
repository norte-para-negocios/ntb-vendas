// rodar com: npx tsx scripts/testes/relatorioCompletoHtml.test.ts
import assert from 'node:assert/strict';
import { analisarVendas } from '../../lib/reports/analiseVendas';
import { buildRelatorioCompletoHtml } from '../../lib/reports/relatorioCompletoHtml';

const meta = { loja: 'ODARA BEACH', periodoLabel: '24/10/2026', geradoEm: new Date('2026-10-25T12:00:00Z'), geradoPor: 'Teste' };
const venda = { id: 'c1', created_at: '2026-10-24T16:10:00Z', status: 'delivered', order_type: 'table', tables: { number: 5 },
  order_items: [{ product_id: 'x', product: { name: 'Prato <b>Especial</b>', category_id: 'pra' }, quantity: 3, price_at_time: 411.5, status: 'pending' }],
  payment_details: { payment_id: 'p1', methods: [{ method: 'PIX', amount: 1234.5 }] } } as any;
const a = analisarVendas([venda], [{ id: 'pra', name: 'Pratos' }]);
const tudo = buildRelatorioCompletoHtml(a, meta);
for (const t of ['Faturamento por dia', 'Produtos vendidos', 'Categorias', 'Formas de pagamento', 'Equipe (quem lançou)', 'Mesas e balcão', 'Contas']) assert.ok(tudo.includes(t), t);
assert.ok(tudo.includes('R$ 1.234,50'));
assert.ok(tudo.includes('Prato &lt;b&gt;Especial&lt;/b&gt;') && !tudo.includes('<b>Especial</b>'));
const so = buildRelatorioCompletoHtml(a, meta, ['produtos']);
assert.ok(so.includes('Produtos vendidos') && !so.includes('Formas de pagamento') && !so.includes('Mesas e balcão'));
const vazio = buildRelatorioCompletoHtml(analisarVendas([], []), meta, ['produtos', 'contas']);
assert.equal((vazio.match(/Nada para mostrar neste período\./g) || []).length, 2);
console.log('relatorioCompletoHtml: ok');
