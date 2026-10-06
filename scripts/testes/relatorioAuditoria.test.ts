// rodar com: npx tsx scripts/testes/relatorioAuditoria.test.ts
import assert from 'node:assert/strict';
import { agruparPorLogin, descreverEvento, ehAlerta, textoWhatsApp, type EventoAuditoria, type Nomes } from '../../lib/relatorioAuditoria';
import { gerarPdfAuditoria } from '../../lib/relatorioAuditoriaPdf';

const nomes: Nomes = { produtos: { p1: 'Caipirinha' }, mesas: { t5: 5 }, pedidos: { o1: { table_id: 't5', order_type: 'table', customer_name: null } }, notas: { n1: { numero: 140, modelo: '65' } } };
let id = 0;
const ev = (o: Partial<EventoAuditoria>): EventoAuditoria => ({ id: ++id, store_id: 's', occurred_at: '2026-10-05T23:30:00Z', actor_user_id: 'u1', actor_name: 'Ana', actor_role: 'waiter', action: 'orders.update', entity: 'orders', entity_id: 'o1', summary: null, details: {}, origin: 'trigger', ...o });

assert.equal(descreverEvento(ev({ action: 'order_items.insert', entity: 'order_items', details: { ctx: { order_id: 'o1' }, linha: { product_id: 'p1', quantity: 2, notes: 'sem gelo' } } }), nomes), 'Lançou 2x Caipirinha (mesa 5) — obs: sem gelo');
assert.match(descreverEvento(ev({ action: 'order_items.update', entity: 'order_items', details: { ctx: { order_id: 'o1', product_id: 'p1' }, mudou: { status: { de: 'pending', para: 'canceled' } } } }), nomes), /^CANCELOU item Caipirinha \(mesa 5\)/);
assert.equal(descreverEvento(ev({ origin: 'app', action: 'reimpressao.cupom_fiscal', summary: 'Reimprimiu NFC-e nº 134' })), 'Reimprimiu NFC-e nº 134');
assert.match(descreverEvento(ev({ action: 'fiscal_notas.update', entity: 'fiscal_notas', entity_id: 'n1', details: { mudou: { status: { de: 'autorizada', para: 'cancelada' } } } }), nomes), /NFC-e nº 140: autorizada para cancelada/);
assert.ok(ehAlerta(ev({ action: 'reimpressao.pedido_kds', origin: 'app' }), 'x'));
assert.ok(ehAlerta(ev({}), 'CANCELOU pedido'));
assert.ok(!ehAlerta(ev({ action: 'order_items.insert' }), 'Lançou 1x X'));
assert.ok(!ehAlerta(ev({ action: 'orders.update' }), 'Registrou pagamento (mesa 5): R$ 10,00'), 'pagamento normal não é alerta');
assert.ok(!ehAlerta(ev({ action: 'cash_shifts.insert' }), 'ABRIU turno de caixa (fundo R$ 0,00)'), 'abrir turno é rotina');
assert.ok(ehAlerta(ev({ action: 'products.update' }), 'Alterou produto X: price: 1 para 2'));
assert.ok(ehAlerta(ev({ action: 'orders.update' }), 'MUDOU o pedido da mesa 1 para a mesa 2'));

assert.equal(descreverEvento(ev({ action: 'orders.update', entity: 'orders', details: { mudou: { table_id: { de: 'tA', para: 'tB' } } } }), { ...nomes, mesas: { tA: 10, tB: 12 } }), 'MUDOU o pedido da mesa 10 para a mesa 12');
assert.match(descreverEvento(ev({ action: 'orders.update', entity: 'orders', details: { ctx: { order_id: 'o1' }, mudou: { payment_details: { de: null, para: { total: 122.87, methods: [{ method: 'CREDIT', amount: 122.87, brand: 'visa' }], operador_nome: 'Ana' } } } } }), nomes), /Registrou pagamento \(mesa 5\): R\$ 122,87 \(R\$ 122,87 em crédito visa\) — recebido por Ana/);
assert.ok(!descreverEvento(ev({ action: 'tables.update', entity: 'tables', entity_id: 't5', details: { mudou: { pin: { de: '1', para: '2' }, status: { de: 'occupied', para: 'available' } } } }), nomes).includes('pin'), 'PIN nunca aparece');
assert.equal(descreverEvento(ev({ action: 'tables.update', entity: 'tables', entity_id: 't5', details: { mudou: { status: { de: 'occupied', para: 'available' } } } }), nomes), 'Mesa 5: ocupada para livre');
assert.ok(!/→/.test(descreverEvento(ev({ action: 'products.update', entity: 'products', details: { mudou: { price: { de: 1, para: 2 } } } }), nomes)), 'a fonte do PDF não tem a seta');

const secoes = agruparPorLogin([
  ev({ occurred_at: '2026-10-05T22:00:00Z', origin: 'app', action: 'login.entrou', summary: 'Ana entrou no sistema' }),
  ev({ occurred_at: '2026-10-05T22:05:00Z', origin: 'app', action: 'reimpressao.pre_conta', summary: 'Imprimiu pré-conta da mesa 5' }),
  ev({ actor_user_id: null, actor_name: '(sem login)', actor_role: null, action: 'orders.insert', details: { linha: { order_type: 'counter' } } }),
], nomes);
assert.equal(secoes.length, 2);
assert.equal(secoes[0].nome, 'Ana');
assert.equal(secoes[0].total, 2);
assert.equal(secoes[0].alertas, 1);
assert.equal(secoes[1].chave, '(sistema)', 'o bloco sem login vai por último');
assert.match(textoWhatsApp({ loja: 'Sertão', dia: '2026-10-05', secoes }), /Ana \(Garçom\): 2 ações/);
assert.match(textoWhatsApp({ loja: 'Sertão', dia: '2026-10-05', secoes: [] }), /Nenhuma ação registrada/);

(async () => {
  const pdf = await gerarPdfAuditoria({ loja: 'Sertão', dia: '2026-10-05', secoes });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const vazio = await gerarPdfAuditoria({ loja: 'Sertão', dia: '2026-10-05', secoes: [] });
  assert.equal(vazio.subarray(0, 4).toString(), '%PDF');
  console.log('relatorioAuditoria: ok');
})().catch((e) => { console.error(e); process.exit(1); });
