import assert from 'node:assert/strict';
import { montarPainel } from '../../lib/reports/painelDia';

const resumo: any = { totals_by_method: { CASH: 100, CREDIT: 300, DEBIT: 50 }, totals_by_card: { 'CREDIT|visa': 200, 'CREDIT|elo': 100, 'DEBIT|visa': 50 }, payments_count: 5, payments_total: 450, total_sangria: 20, total_suprimento: 0, service_fee_total: 45 };
const venda = (id: string, h: string, itens: any[], op = 'ANE'): any => ({ id, table_id: id, status: 'delivered', created_at: h, order_type: 'table', total: 0,
  payment_details: { operador_nome: op, methods: [{ method: 'CASH', amount: 100 }] }, order_items: itens });
const it = (nome: string, q: number, p: number, extra: any = {}) => ({ quantity: q, price_at_time: p, status: 'delivered', product: { name: nome, category_id: 'c1', ...extra } });
const p = montarPainel({ loja: 'X', periodoLabel: 'd', geradoEm: new Date(), geradoPor: 'u', excecoes: [{}] as any,
  turnos: [{ operador: 'ANE', abertoEm: '', fechadoEm: null, fundo: 0, contado: null, resumo }, { operador: 'B', abertoEm: '', fechadoEm: null, fundo: 0, contado: null, resumo }],
  vendas: [venda('1', '2026-10-04T22:00:00Z', [it('Pizza', 1, 100), it('Taxa', 1, 10, { fee_type: 'percent' })]), venda('2', '2026-10-04T22:30:00Z', [it('Pizza', 2, 100)], 'B')] }, (id) => (id === 'c1' ? 'Pizzas' : undefined));
assert.equal(p.kpis.contas, 10); assert.equal(p.kpis.recebido, 900); assert.equal(p.kpis.ticket, 90);
assert.equal(p.kpis.credito, 600); assert.equal(p.kpis.debito, 100);
assert.equal(p.kpis.itens, 3, 'taxa não conta como item vendido');
assert.deepEqual(p.topProdutos, [{ nome: 'Pizza', qtd: 3, total: 300 }]);
assert.equal(p.porCategoria[0].label, 'Pizzas');
assert.equal(p.porOperador.length, 2);
assert.ok(p.melhorHora);
assert.equal(p.cartoes.length >= 12, true, 'cartões zerados continuam listados');
assert.equal(montarPainel({ loja: 'X', periodoLabel: 'd', geradoEm: new Date(), geradoPor: 'u', excecoes: [], turnos: [], vendas: [] }).melhorHora, null);
console.log('painelDia: ok');
