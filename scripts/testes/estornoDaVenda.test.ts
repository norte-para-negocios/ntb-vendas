// Roda contra a loja de laboratório (ZZ) no banco de produção; limpa tudo no fim.
// rodar com: npx tsx scripts/testes/estornoDaVenda.test.ts
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { estornarVendaDaNota } from '../../lib/fiscal/estornoDaVenda';

const ZZ = 'f33b4310-ff0a-487c-a3b1-62acd0a58850';
const TURNO_ABERTO = '9a4b8a40-6efe-4ba1-ae5d-ce3b401c7fa8';
const TURNO_FECHADO = '782b69b5-49a6-404a-b85f-ae354a4f2d90';
const NOTA_FALSA = '00000000-0000-4000-8000-000000000001';
const admin = getSupabaseAdmin();
const criados: string[] = [];

async function criarPedido(payment: unknown) {
  const { data, error } = await admin.from('orders').insert({ store_id: ZZ, order_type: 'table', status: 'delivered', total: 30, payment_method: payment ? 'CASH' : null, payment_details: payment }).select('id').single();
  assert.ok(!error, error?.message);
  criados.push(data!.id);
  return data!.id as string;
}
const esperado = async (turno: string) => Number(((await admin.rpc('fetch_cash_shift_summary_secure', { p_shift_id: turno })).data as any).expected_cash);

(async () => {
  try {
    const { data: prod } = await admin.from('products').select('id, category_id').eq('store_id', ZZ).limit(1).single();
    const pagamento = (turno: string) => ({ total: 30, methods: [{ method: 'CASH', amount: 30 }], cash_shift_id: turno });

    // 1) venda paga em dinheiro num caixa ABERTO → estorno tira do caixa, do histórico e cancela itens
    const a = await criarPedido(pagamento(TURNO_ABERTO));
    await admin.from('order_items').insert({ order_id: a, store_id: ZZ, product_id: prod!.id, quantity: 1, status: 'delivered', price_at_time: 30 });
    const antes = await esperado(TURNO_ABERTO);
    const r = await estornarVendaDaNota(admin, { storeId: ZZ, orderId: a, notaId: NOTA_FALSA, justificativa: 'teste automatizado' });
    assert.equal(r.estornada, true, JSON.stringify(r));
    assert.equal(await esperado(TURNO_ABERTO), antes - 30, 'caixa esperado cai o valor recebido');
    const { data: ped } = await admin.from('orders').select('status, payment_method, payment_details').eq('id', a).single();
    assert.equal(ped!.status, 'canceled', 'pedido cancelado (sai do histórico, que só lista delivered)');
    assert.equal(ped!.payment_method, null);
    assert.ok(!(ped!.payment_details as any).methods, 'forma de pagamento não conta mais');
    assert.ok((ped!.payment_details as any).estornado_por_cancelamento_de_nota?.methods, 'original preservado pra auditoria');
    const { data: itens } = await admin.from('order_items').select('status').eq('order_id', a);
    assert.ok(itens!.every((i) => i.status === 'canceled'), 'itens cancelados');
    const { data: ev } = await admin.from('cash_shift_audit_events').select('event_type, details').eq('store_id', ZZ).eq('details->>order_id', a);
    assert.equal(ev!.length, 1, 'um evento de auditoria');
    assert.equal(ev![0].event_type, 'pagamento_estornado');

    // 2) repetir não estorna de novo
    const r2 = await estornarVendaDaNota(admin, { storeId: ZZ, orderId: a, notaId: NOTA_FALSA, justificativa: 'teste' });
    assert.equal(r2.estornada, false);
    assert.match(r2.motivo ?? '', /já cancelado/);
    assert.equal(await esperado(TURNO_ABERTO), antes - 30, 'segunda chamada não mexe no caixa');

    // 3) caixa já FECHADO: não mexe em nada (ajuste é do supervisor)
    const b = await criarPedido(pagamento(TURNO_FECHADO));
    const r3 = await estornarVendaDaNota(admin, { storeId: ZZ, orderId: b, notaId: NOTA_FALSA, justificativa: 'teste' });
    assert.equal(r3.estornada, false);
    assert.match(r3.motivo ?? '', /fechado/);
    assert.equal((await admin.from('orders').select('status').eq('id', b).single()).data!.status, 'delivered');

    // 4) pedido sem pagamento registrado: nada a estornar
    const c = await criarPedido(null);
    const r4 = await estornarVendaDaNota(admin, { storeId: ZZ, orderId: c, notaId: NOTA_FALSA, justificativa: 'teste' });
    assert.equal(r4.estornada, false);

    // 5) pedido de OUTRA loja nunca é tocado
    const r5 = await estornarVendaDaNota(admin, { storeId: '4f8a9e1a-6c3d-4b2e-9f7a-8e5c1d2b3a90', orderId: b, notaId: NOTA_FALSA, justificativa: 'teste' });
    assert.equal(r5.estornada, false);
    console.log('ok');
  } finally {
    for (const id of criados) {
      await admin.from('cash_shift_audit_events').delete().eq('store_id', ZZ).eq('details->>order_id', id);
      await admin.from('order_items').delete().eq('order_id', id);
      await admin.from('orders').delete().eq('id', id);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
