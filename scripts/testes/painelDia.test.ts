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

// Turno que atravessa o dia (parcial): só entram as vendas DO PERÍODO ligadas a ele, nunca o total do turno inteiro (sem dupla contagem)
const resumoLongo: any = { totals_by_method: { CASH: 5000 }, totals_by_card: {}, payments_count: 80, payments_total: 5000, total_sangria: 0, total_suprimento: 0, service_fee_total: 400 };
const vendaDoTurno = (id: string, shift: string, valor: number): any => ({ id, table_id: id, status: 'delivered', created_at: '2026-09-29T20:00:00Z', order_type: 'table', total: valor,
  payment_details: { cash_shift_id: shift, methods: [{ method: 'CASH', amount: valor }] }, order_items: [it('Prato', 1, valor), it('Taxa', 1, valor * 0.1, { fee_type: 'percent' })] });
const pp = montarPainel({ loja: 'X', periodoLabel: 'd', geradoEm: new Date(), geradoPor: 'u', excecoes: [],
  turnos: [{ id: 'T1', parcial: true, operador: 'QA', abertoEm: '2026-09-12T21:00:00Z', fechadoEm: null, fundo: 0, contado: null, resumo: resumoLongo },
           { id: 'T2', operador: 'ANE', abertoEm: '', fechadoEm: null, fundo: 0, contado: null, resumo }],
  vendas: [vendaDoTurno('v1', 'T1', 30), vendaDoTurno('v2', 'OUTRO', 77)] } as any);
assert.equal(pp.kpis.recebido, 450 + 30, 'turno parcial soma só a venda do dia (30), não os 5000 do turno inteiro');
assert.equal(pp.kpis.contas, 5 + 1);
assert.equal(pp.kpis.taxa, 45 + 3, 'taxa do turno parcial sai dos itens-taxa das vendas do dia');
assert.equal(pp.formas.find((f) => f.key === 'CASH')!.total, 100 + 30);
console.log('painelDia: ok');
