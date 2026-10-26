// rodar com: npx tsx scripts/testes/analiseEquipe.test.ts
import assert from 'node:assert/strict';
import { analisarEquipe, linhaDoTempo, normalizarNome, type AtividadeEquipe } from '../../lib/reports/analiseEquipe';

const cats = [{ id: 'beb', name: 'Bebidas' }, { id: 'pra', name: 'Pratos' }];
const it = (nome: string, cat: string, q: number, preco: number, quem: string, quando: string, extra: Record<string, unknown> = {}) =>
  ({ product_id: nome, product: { name: nome, category_id: cat }, quantity: q, price_at_time: preco, status: 'delivered', added_by_role: 'garcom', added_by_name: quem, created_at: quando, ...extra });
const conta = (id: string, quando: string, itens: unknown[], metodos: { method: string; amount: number }[], operador: string, extra: Record<string, unknown> = {}) =>
  ({ id, created_at: quando, updated_at: quando, status: 'delivered', order_type: 'table', tables: { number: 12 }, order_items: itens, payment_details: { payment_id: `p-${id}`, methods: metodos, operador_nome: operador }, ...extra }) as any;

const vendas = [
  conta('c1', '2026-10-24T16:30:00Z', [
    it('Cerveja', 'beb', 2, 10, 'Talislane', '2026-10-24T13:10:20Z'),
    it('Moqueca', 'pra', 1, 100, 'Talislane', '2026-10-24T13:10:40Z'),
    it('Água', 'beb', 1, 5, 'Talislane', '2026-10-24T13:10:50Z'),
    it('Suco', 'beb', 1, 8, 'Talislane', '2026-10-24T14:00:00Z', { status: 'canceled' }),
  ], [{ method: 'PIX', amount: 125 }], 'Herica Santos Uchoa Lacerda'),
  // 100% cortesia: não é recebimento
  conta('c2', '2026-10-24T17:00:00Z', [it('Cerveja', 'beb', 1, 10, 'Ana Souza', '2026-10-24T16:50:00Z')], [{ method: 'COURTESY', amount: 10 }], 'Herica'),
  conta('c4', '2026-10-24T17:30:00Z', [it('Água', 'beb', 1, 5, 'Ana Souza', '2026-10-24T17:20:00Z')], [{ method: 'CASH', amount: 5 }], 'Ana Souza'),
  conta('c3', '2026-10-24T18:00:00Z', [it('Cerveja', 'beb', 3, 10, 'Ana Lima', '2026-10-24T17:50:00Z')], [{ method: 'CASH', amount: 30 }], 'Ana Lima'),
];

const ev = (quando: string, quem: string, acao: string, papel = 'cashier', resumo: string | null = null) => ({ quando, quem, papel, acao, resumo, detalhe: {} });
const atividade: AtividadeEquipe = {
  cortado: false,
  eventos: [
    ev('2026-10-24T10:00:00Z', 'Herica', 'login.entrou'),
    ev('2026-10-24T12:30:00Z', 'Herica', 'login.saiu'),
    ev('2026-10-24T13:00:00Z', 'Herica', 'reimpressao.pre_conta', 'cashier', 'Imprimiu pré-conta da mesa 12'),
    ev('2026-10-24T14:00:00Z', 'Talislane', 'login.entrou', 'open'),
    ev('2026-10-24T14:05:00Z', 'Mesas', 'mesa.abriu', 'open'),
    ev('2026-10-24T14:06:00Z', 'Talislane', 'mesa.trocada', 'open', 'Mesa 1 → Mesa 12'),
  ],
};
const excecoes = {
  by_operator: [{ operator_name: 'Talislane', counts: { item_cancelado: 1 }, values: { item_cancelado: 8 } }],
  events: [{ operator_name: 'Talislane', event_type: 'item_cancelado', created_at: '2026-10-24T14:01:00Z', details: { produto: 'Suco', motivo: 'Cliente desistiu', valor: 8 } }],
  notas_canceladas: { count: 0, valor: 0 },
};
const checkins = [{ id: 'k1', store_id: 's', user_id: 'u', user_name: 'Talislane', checkin_at: '2026-10-24T13:00:00Z', checkout_at: '2026-10-24T15:00:00Z' }];
const fontes = { vendas, categorias: cats, atividade, excecoes, checkins, fimPeriodo: '2026-10-24T18:00:00Z' };

assert.equal(normalizarNome('  Hérica   SANTOS '), 'herica santos');

const r = analisarEquipe(fontes);
const nomes = r.pessoas.map((p) => p.nome);
// "Herica" (login) e "Herica Santos Uchoa Lacerda" (quem recebeu) são a mesma pessoa
assert.ok(nomes.includes('Herica Santos Uchoa Lacerda'));
assert.ok(!nomes.includes('Herica'));
// duas Anas com sobrenomes diferentes continuam separadas
assert.ok(nomes.includes('Ana Souza') && nomes.includes('Ana Lima'));
// aparelho fora do ranking
assert.ok(!nomes.includes('Mesas'));
assert.deepEqual(r.aparelhos.map((a) => a.nome), ['Mesas']);

const tal = r.pessoas.find((p) => p.nome === 'Talislane')!;
assert.equal(tal.lancou.valor, 125); // suco cancelado fora
assert.equal(tal.lancou.itens, 4);
assert.equal(tal.lancou.contas, 1);
assert.equal(tal.lancou.mesas, 1);
assert.equal(tal.lancou.porHora[10], 4); // 13:10Z = 10h na Bahia
assert.deepEqual(tal.excecoes.cancelados, { qtd: 1, valor: 8 });
assert.equal(tal.mesasTrocadas, 1);
assert.equal(tal.ponto.minutos, 120);
// entrou 14:00Z sem saída: vai até a última atividade dela (troca de mesa 14:06Z)
assert.equal(tal.login.minutos, 6);
assert.equal(tal.papel, 'waiter'); // Modo Aberto conta como garçom

const her = r.pessoas.find((p) => p.nome === 'Herica Santos Uchoa Lacerda')!;
assert.equal(her.recebeu.contas, 1); // cortesia total não conta
assert.equal(her.recebeu.valor, 125);
assert.deepEqual(her.recebeu.porForma.map((f) => [f.chave, f.total]), [['PIX', 125]]);
assert.equal(her.login.entradas, 1);
assert.equal(her.login.minutos, 150);
assert.equal(her.preContas, 1);
assert.equal(her.papel, 'cashier');

// recebeu e lançou da mesma pessoa somam no ranking
const ana = r.pessoas.find((p) => p.nome === 'Ana Lima')!;
assert.equal(ana.lancou.valor, 30);
assert.equal(ana.recebeu.valor, 30);

// login sem saída: atividade 20 h depois não conta (teto de 12 h); sem atividade nenhuma = 0
const longo = analisarEquipe({ ...fontes, atividade: { cortado: false, eventos: [ev('2026-10-24T10:00:00Z', 'Zé', 'login.entrou'), ev('2026-10-24T13:00:00Z', 'Zé', 'reimpressao.pre_conta'), ev('2026-10-25T06:00:00Z', 'Zé', 'reimpressao.pre_conta')] }, fimPeriodo: '2026-10-26T10:00:00Z' });
assert.equal(longo.pessoas.find((p) => p.nome === 'Zé')!.login.minutos, 180);
const parado = analisarEquipe({ ...fontes, atividade: { cortado: false, eventos: [ev('2026-10-24T10:00:00Z', 'Zé', 'login.entrou')] } });
assert.equal(parado.pessoas.find((p) => p.nome === 'Zé')!.login.minutos, 0);

// sem atividade (RPC falhou): só vendas, sem erro
const sem = analisarEquipe({ ...fontes, atividade: null, excecoes: null, checkins: [] });
assert.equal(sem.pessoas.find((p) => p.nome === 'Talislane')!.login.entradas, 0);
assert.ok(sem.pessoas.some((p) => p.nome === 'Herica Santos Uchoa Lacerda'));

// linha do tempo: 3 itens do mesmo pedido no mesmo minuto = 1 linha
const lt = linhaDoTempo('Talislane', fontes);
const lanc = lt.filter((e) => e.tipo === 'lancou');
assert.equal(lanc.length, 1);
assert.equal(lanc[0].valor, 125);
assert.match(lanc[0].texto, /2× Cerveja/);
assert.match(lanc[0].texto, /Mesa 12/);
assert.ok(lt.some((e) => e.tipo === 'cancelou' && /Suco/.test(e.texto)));
assert.ok(lt.some((e) => e.tipo === 'login'));
assert.ok(lt.some((e) => e.tipo === 'ponto'));
// mais recente primeiro
assert.ok(lt.every((e, i) => i === 0 || lt[i - 1].quando >= e.quando));
// alias: linha do tempo pelo nome curto acha a mesma pessoa
assert.ok(linhaDoTempo('Herica Santos Uchoa Lacerda', fontes).some((e) => e.tipo === 'recebeu' && e.valor === 125));
assert.ok(linhaDoTempo('Herica Santos Uchoa Lacerda', fontes).some((e) => e.tipo === 'pre_conta'));

console.log('analiseEquipe: ok');
