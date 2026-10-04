// rodar com: npx tsx scripts/testes/adminStatus.test.ts
import assert from 'node:assert/strict';
import { contarContasDeHoje, statusVendas, statusCaixa, statusCardapio, statusEquipe, statusConfig, TOM_COR } from '../../lib/adminStatus';

assert.equal(statusVendas(null), null);
assert.equal(statusCaixa(null), null);
assert.equal(statusCardapio(null), null);
assert.equal(statusEquipe(null), null);
assert.equal(statusConfig(null, null, null), null);
assert.equal(statusVendas(Number.NaN), null);

assert.deepEqual(statusVendas(0), { texto: 'Sem vendas hoje', tom: 'neutro' });
assert.deepEqual(statusVendas(1), { texto: '1 conta hoje', tom: 'ok' });
assert.deepEqual(statusVendas(12), { texto: '12 contas hoje', tom: 'ok' });
assert.deepEqual(statusCaixa(0), { texto: 'Nenhum caixa aberto', tom: 'neutro' });
assert.deepEqual(statusCaixa(2), { texto: '2 caixas abertos', tom: 'ok' });
assert.deepEqual(statusCaixa(1), { texto: '1 caixa aberto', tom: 'ok' });
assert.deepEqual(statusCardapio(0), { texto: 'Cardápio em ordem', tom: 'ok' });
assert.deepEqual(statusCardapio(3), { texto: '3 alertas no cardápio', tom: 'atencao' });
assert.deepEqual(statusCardapio(1), { texto: '1 alerta no cardápio', tom: 'atencao' });
// Estoque ligado e nenhum produto vinculado: nunca "em ordem"
assert.deepEqual(statusCardapio(0, { estoqueSemVinculo: true }), { texto: 'Estoque ligado, 0 vinculados', tom: 'atencao' });
assert.deepEqual(statusCardapio(4, { estoqueSemVinculo: true }), { texto: 'Estoque ligado, 0 vinculados', tom: 'atencao' });
assert.deepEqual(statusCardapio(0, { estoqueSemVinculo: false }), { texto: 'Cardápio em ordem', tom: 'ok' });
assert.equal(statusCardapio(null, { estoqueSemVinculo: true }), null);
assert.deepEqual(statusEquipe(1), { texto: '1 pessoa', tom: 'neutro' });
assert.deepEqual(statusEquipe(5), { texto: '5 pessoas', tom: 'neutro' });

const ok = { certificadoValido: true, cscHomologacao: true, cscProducao: true };
assert.deepEqual(statusConfig([{ is_active: true }, { is_active: true }], ok, 'producao'), { texto: '2 impressoras ativas · Produção', tom: 'ok' });
assert.deepEqual(statusConfig([{ is_active: true }], ok, 'homologacao'), { texto: '1 impressora ativa · Homologação', tom: 'atencao' });
assert.deepEqual(statusConfig([], ok, 'producao'), { texto: 'Nenhuma impressora · Produção', tom: 'atencao' });
assert.deepEqual(statusConfig([{ is_active: false }], ok, 'producao'), { texto: 'Nenhuma impressora ativa · Produção', tom: 'atencao' });
assert.equal(statusConfig([{ is_active: true }], { ...ok, certificadoValido: false }, 'producao')!.tom, 'erro');
assert.equal(statusConfig([{ is_active: true }], { ...ok, cscProducao: false }, 'producao')!.tom, 'erro');
assert.equal(statusConfig([{ is_active: true }], null, null)!.texto, '1 impressora ativa');

// contas de hoje: dia local de Salvador, uma conta (mesa + mesmo pagamento) conta uma vez, cancelada não conta
const agora = new Date('2026-10-04T15:00:00Z');
const o = (id: string, iso: string, extra: object = {}) => ({ id, created_at: iso, status: 'delivered', table_id: null, payment_details: { methods: [{ method: 'pix', amount: 10 }] }, ...extra });
assert.equal(contarContasDeHoje([], agora), 0);
assert.equal(contarContasDeHoje([o('a', '2026-10-04T14:00:00Z'), o('b', '2026-10-04T14:10:00Z')] as never, agora), 2);
assert.equal(contarContasDeHoje([o('a', '2026-10-04T14:00:00Z', { table_id: 't1' }), o('b', '2026-10-04T14:01:00Z', { table_id: 't1' })] as never, agora), 1, 'mesma mesa e pagamento = 1 conta');
assert.equal(contarContasDeHoje([o('a', '2026-10-03T14:00:00Z')] as never, agora), 0, 'ontem não conta');
assert.equal(contarContasDeHoje([o('a', '2026-10-04T14:00:00Z', { status: 'canceled' })] as never, agora), 0);
assert.equal(contarContasDeHoje([o('a', '2026-10-04T01:00:00Z')] as never, agora), 0, '01:00 UTC = 22:00 de ontem em Salvador');

Object.values(TOM_COR).forEach((c) => assert.match(c, /^var\(--/));
console.log('adminStatus: ok');
