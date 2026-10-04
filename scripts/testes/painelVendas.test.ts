// rodar com: npx tsx scripts/testes/painelVendas.test.ts
import assert from 'node:assert/strict';
import { montarPainelDeVendas } from '../../lib/reports/painelDia';

const pd = (methods: any[], op = 'ANE') => ({ operador_nome: op, methods });
const venda = (id: string, mesa: string, h: string, methods: any[], itens: any[] = [], status = 'delivered'): any => ({ id, table_id: mesa, status, created_at: h, order_type: 'table', total: 0, payment_details: pd(methods), order_items: itens });
const it = (n: string, q: number, p: number) => ({ id: n, quantity: q, price_at_time: p, status: 'delivered', product: { name: n, category_id: 'c1' } });
const metodos = [{ method: 'CREDIT', brand: 'visa', amount: 60 }, { method: 'CASH', amount: 40 }];

const vendas = [
  venda('1', 'M1', '2026-10-04T22:00:00Z', metodos, [it('Pizza', 1, 100)]),
  venda('2', 'M1', '2026-10-04T22:05:00Z', metodos, [it('Suco', 1, 10)]),     // mesma conta (2º pedido da mesa): não conta em dobro (Review Focus 5)
  venda('3', 'M2', '2026-10-04T23:00:00Z', [{ method: 'PIX', amount: 50 }], [it('Pizza', 1, 50)]),
  venda('4', 'M3', '2026-10-04T23:10:00Z', [{ method: 'CASH', amount: 5 }], [], 'canceled'),
];
const p = montarPainelDeVendas(vendas, () => 'Pizzas');

assert.equal(p.kpis.contas, 2, 'duas contas pagas');
assert.equal(p.kpis.recebido, 150, '60+40 da conta M1 + 50 do PIX');
assert.equal(p.kpis.ticket, 75);
assert.equal(p.kpis.credito, 60);
assert.equal(p.kpis.debito, 0);
assert.equal(p.kpis.cancelamentos, 1);
assert.equal(p.kpis.taxa, 0);
assert.equal(p.formas.find((f) => f.key === 'CASH')!.total, 40);
assert.equal(p.formas.find((f) => f.key === 'DEBIT')!.total, 0, 'forma fixa zerada continua listada');
assert.equal(p.cartoes.find((c) => c.label === 'Visa crédito')!.total, 60);
assert.equal(montarPainelDeVendas([]).kpis.ticket, null, 'sem vendas: ticket null, não NaN');

// Review Focus 1: categoria que não resolve nunca aparece como id; vira "Sem categoria"
const semNome = montarPainelDeVendas(vendas, () => undefined);
assert.ok(semNome.porCategoria.every((r) => r.label === 'Sem categoria'), 'sem id de categoria na tela');
assert.equal(semNome.porCategoria.length, 1, 'categorias sem nome somam numa linha só');
assert.equal(semNome.porCategoria[0].total, 160);
console.log('painelVendas: ok');
