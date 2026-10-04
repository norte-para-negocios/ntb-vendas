// rodar com: npx tsx scripts/testes/notificacoes.test.ts
import assert from 'node:assert/strict';
import {
  publicosDoUsuario, tiposAplicaveis, resolverPrefs, detectarMesas, detectarItens, reconciliar, filtrarEventos,
  contarNaoLidos, marcarLidos, somDoEvento, tempoRelativo, detectarImpressoras, detectarNotas, detectarSangrias, detectarEstoque, serializarEventos, restaurarEventos, type EventoNotificacao,
} from '../../lib/notificacoes';

const AGORA = Date.parse('2026-10-04T22:00:00Z');

// -- quem vê o quê
assert.deepEqual(publicosDoUsuario({ role: 'waiter' }), ['salao']);
assert.ok(publicosDoUsuario({ role: 'cashier' }).includes('caixa'));
assert.ok(publicosDoUsuario({ role: 'waiter', permissions: { caixa: true } }).includes('caixa'));
assert.ok(publicosDoUsuario({ role: 'manager' }).includes('gerencia'));
assert.deepEqual(publicosDoUsuario({ role: 'waiter', permissions: { kitchen: true } }), ['salao', 'cozinha']);

// -- aplicabilidade por loja (Review Focus: lojas sem KDS)
assert.equal(tiposAplicaveis({ config: {} }).has('pedido_novo'), true, 'loja de hoje: KDS ligado');
assert.equal(tiposAplicaveis({ config: { order_flow: 'direct_print' } }).has('pedido_novo'), false, 'impressão direta não tem KDS');
assert.equal(tiposAplicaveis({ config: { modules: { kitchen_kds: false, bar_kds: false } } }).has('item_pronto'), false);
assert.equal(tiposAplicaveis({ config: { order_flow: 'direct_print' } }).has('impressora_falhou'), true);

// -- preferências: ausente = tudo ligado; lixo ignorado
assert.equal(resolverPrefs(undefined).som, true);
assert.equal(resolverPrefs({ notifications: { som: false, tipos: { estoque_baixo: false, pedido_novo: 'sim' } } }).tipos.estoque_baixo, false);
assert.equal(resolverPrefs({ notifications: { tipos: { pedido_novo: 'sim' } } }).tipos.pedido_novo, true);

// -- mesas: sem aviso de "cliente sentou"
const mesas = detectarMesas([
  { id: 'm1', number: 1, status: 'occupied', waiter_requested: true },
  { id: 'm2', number: 2, status: 'waiting_bill' },
  { id: 'm3', number: 3, status: 'occupied' },
  { id: 'm4', number: 4, status: 'available', waiter_requested: true },
]);
assert.deepEqual(mesas.map((m) => m.id), ['chamada_garcom:m1', 'pedido_conta:m2']);

// -- itens: um aviso por pedido e local; setor apagado cai na base
const item = (id: string, status: string, extra: any = {}) => ({ id, order_id: 'o1', status, sector_id: null, created_at: '2026-10-04T21:00:00Z', product: { name: 'Pizza', prep_time_minutes: 30 }, order: { order_type: 'table', tables: { number: 12 } }, ...extra });
const det = detectarItens([
  item('i1', 'pending', { sector_id: 'p1' }), item('i2', 'pending', { sector_id: 'p1' }), item('i3', 'ready'), item('i4', 'preparing', { sector_id: 'apagado' }),
], 'kitchen', { p1: 'Pizzaria' }, AGORA);
assert.equal(det.filter((d) => d.tipo === 'pedido_novo').length, 1, 'dois itens do mesmo pedido/local = 1 aviso');
assert.equal(det.find((d) => d.tipo === 'pedido_novo')!.localChave, 'setor:p1');
assert.equal(det.find((d) => d.tipo === 'item_pronto')!.id, 'item_pronto:i3');
assert.ok(det.some((d) => d.id === 'item_atrasado:i4' && d.localChave === 'kitchen'), '60 min > 30 min de preparo; setor apagado cai na Cozinha');
assert.equal(detectarItens([item('i5', 'pending', { product: { name: 'Água' } })], 'bar', {}, AGORA).some((d) => d.tipo === 'item_atrasado'), false, 'sem tempo de preparo não atrasa');

// -- reconciliar: dedupe, resolução, reativação, fonte fora do ar
let r = reconciliar([], mesas, ['chamada_garcom', 'pedido_conta'], AGORA);
assert.equal(r.novos.length, 2);
r = reconciliar(r.lista, mesas, ['chamada_garcom', 'pedido_conta'], AGORA + 5000);
assert.equal(r.novos.length, 0, 'mesmo aviso no poll seguinte não toca de novo');
r = reconciliar(r.lista, [mesas[1]], ['chamada_garcom', 'pedido_conta'], AGORA + 10000);
assert.equal(r.lista.find((e) => e.id === 'chamada_garcom:m1')!.ativo, false, 'mesa atendida some dos ativos');
assert.equal(r.lista.find((e) => e.id === 'pedido_conta:m2')!.ativo, true);
const fora = reconciliar(r.lista, [], [], AGORA + 15000);   // nenhuma fonte respondeu (offline)
assert.equal(fora.lista.find((e) => e.id === 'pedido_conta:m2')!.ativo, true, 'offline não resolve nada');
r = reconciliar(r.lista, mesas, ['chamada_garcom', 'pedido_conta'], AGORA + 20000);
assert.deepEqual(r.novos.map((e) => e.id), ['chamada_garcom:m1'], 'chamou de novo = toca de novo');
const velho = reconciliar([{ id: 'x', tipo: 'pedido_conta', titulo: 't', criadoEm: AGORA - 7 * 3600e3, lido: true, ativo: false }], [], [], AGORA);
assert.equal(velho.lista.length, 0, 'inativo com mais de 6h sai do histórico');
const muitos = reconciliar([], Array.from({ length: 150 }, (_, k) => ({ id: `chamada_garcom:${k}`, tipo: 'chamada_garcom' as const, titulo: 't' })), ['chamada_garcom'], AGORA);
assert.equal(muitos.lista.length, 100, 'limite de 100');

// -- filtro por função, preferência e local
const lista: EventoNotificacao[] = [
  { id: 'a', tipo: 'estoque_baixo', titulo: 'e', criadoEm: 1, lido: false, ativo: true },
  { id: 'b', tipo: 'pedido_novo', titulo: 'p', criadoEm: 2, lido: false, ativo: true, localChave: 'bar' },
  { id: 'c', tipo: 'pedido_novo', titulo: 'p2', criadoEm: 3, lido: false, ativo: true, localChave: 'setor:p1' },
  { id: 'd', tipo: 'chamada_garcom', titulo: 'c', criadoEm: 4, lido: false, ativo: true },
];
const base = { prefs: resolverPrefs(undefined), aplicaveis: tiposAplicaveis({ config: {} }), locaisPermitidos: null };
assert.deepEqual(filtrarEventos(lista, { ...base, publicos: ['salao'] }).map((e) => e.id), ['d'], 'garçom só vê chamadas');
assert.deepEqual(filtrarEventos(lista, { ...base, publicos: ['bar'], locaisPermitidos: new Set(['bar']) }).map((e) => e.id), ['b'], 'bar só vê o próprio local');
assert.equal(filtrarEventos(lista, { ...base, publicos: publicosDoUsuario({ role: 'manager' }) }).length, 4);
assert.equal(filtrarEventos(lista, { ...base, publicos: ['gerencia'], prefs: resolverPrefs({ notifications: { tipos: { estoque_baixo: false } } }) }).some((e) => e.tipo === 'estoque_baixo'), false);
assert.equal(filtrarEventos(lista, { ...base, publicos: ['gerencia'], aplicaveis: tiposAplicaveis({ config: { order_flow: 'direct_print' } }) }).some((e) => e.tipo === 'pedido_novo'), false);

// -- item pronto: o garçom é avisado das SUAS mesas mesmo sem acesso à aba Cozinha/Bar (achado F7)
const prontos: EventoNotificacao[] = [
  { id: 'item_pronto:1', tipo: 'item_pronto', titulo: 'Pronto: Pizza', criadoEm: 1, lido: false, ativo: true, localChave: 'kitchen', mesaId: 'mesa-A' },
  { id: 'item_pronto:2', tipo: 'item_pronto', titulo: 'Pronto: Suco', criadoEm: 2, lido: false, ativo: true, localChave: 'bar', mesaId: 'mesa-B' },
  { id: 'item_pronto:3', tipo: 'item_pronto', titulo: 'Pronto: Água', criadoEm: 3, lido: false, ativo: true, localChave: 'setor:p1', mesaId: null },
  { id: 'pedido_novo:x', tipo: 'pedido_novo', titulo: 'Pedido novo', criadoEm: 4, lido: false, ativo: true, localChave: 'kitchen', mesaId: 'mesa-A' },
];
const semAcessoKds = { ...base, publicos: publicosDoUsuario({ role: 'waiter', permissions: { kitchen: false, bar: false } }), locaisPermitidos: new Set<string>() };
assert.deepEqual(filtrarEventos(prontos, semAcessoKds).map((e) => e.id), ['item_pronto:1', 'item_pronto:2', 'item_pronto:3'], 'garçom sem KDS recebe item pronto, e só ele (não pedido novo)');
assert.deepEqual(filtrarEventos(prontos, { ...semAcessoKds, mesasDoUsuario: new Set(['mesa-A']) }).map((e) => e.id), ['item_pronto:1', 'item_pronto:3'], 'garçom com mesas atribuídas só recebe das suas (balcão/sem mesa continua)');
assert.deepEqual(filtrarEventos(prontos, { ...base, publicos: ['bar'], locaisPermitidos: new Set(['bar']) }).map((e) => e.id), [], 'só público bar não recebe item pronto (público salão/gerência)');

// -- lidos
assert.equal(contarNaoLidos(lista), 4);
assert.equal(contarNaoLidos(marcarLidos(lista, ['a'])), 3);
assert.equal(contarNaoLidos(marcarLidos(lista)), 0);

// -- som
const pedido = lista[1];
assert.equal(somDoEvento(pedido, { prefs: resolverPrefs(undefined), abaAtual: 'tables' }), 'pedido');
assert.equal(somDoEvento(pedido, { prefs: resolverPrefs(undefined), abaAtual: 'producao' }), null, 'KDS aberto já toca o próprio som');
assert.equal(somDoEvento(lista[3], { prefs: resolverPrefs(undefined), abaAtual: 'producao' }), 'mesa', 'chamada continua tocando no KDS');
assert.equal(somDoEvento(pedido, { prefs: resolverPrefs({ notifications: { som: false } }), abaAtual: 'tables' }), null);
assert.equal(somDoEvento(lista[0], { prefs: resolverPrefs(undefined), abaAtual: 'tables' }), null, 'estoque baixo é silencioso');

// -- persistência
assert.deepEqual(restaurarEventos(serializarEventos(lista)), lista);
assert.deepEqual(restaurarEventos('lixo{'), []);
assert.deepEqual(restaurarEventos('[{"id":1},{"id":"z","tipo":"nada","titulo":"x","criadoEm":1,"lido":false,"ativo":true}]'), []);
assert.deepEqual(restaurarEventos(null), []);
// -- fontes lentas
assert.deepEqual(detectarImpressoras([
  { id: 'j1', status: 'error', title: 'Ticket Mesa 3', created_at: '2026-10-04T21:30:00Z' },
  { id: 'j2', status: 'error', title: 'velho', created_at: '2026-10-04T10:00:00Z' },
  { id: 'j3', status: 'done', title: 'ok', created_at: '2026-10-04T21:59:00Z' },
], AGORA).map((d) => d.id), ['impressora_falhou:j1'], 'só erro recente');
const notas = detectarNotas([
  { id: 'n1', status: 'rejeitada', modelo: '65', numero: 80, motivo_erro: 'cStat 225 Falha no Schema XML', created_at: '2026-10-04T20:00:00Z' },
  { id: 'n2', status: 'autorizada', modelo: '65', numero: 81, created_at: '2026-10-04T20:00:00Z' },
  { id: 'n3', status: 'erro', modelo: '55', numero: null, created_at: '2026-10-01T20:00:00Z' },
], AGORA);
assert.deepEqual(notas.map((n) => n.id), ['nota_rejeitada:n1']);
assert.equal(notas[0].titulo, 'NFC-e nº 80 rejeitada');
const sang = detectarSangrias([
  { operator_name: 'ANE', event_type: 'sangria_grande', created_at: '2026-10-04T21:00:00Z', details: { valor: 1500, motivo: 'cofre' } },
  { operator_name: 'ANE', event_type: 'item_cancelado', created_at: '2026-10-04T21:05:00Z', details: {} },
]);
assert.equal(sang.length, 1);
assert.equal(sang[0].titulo, 'Sangria de R$ 1500,00');
assert.equal(sang[0].detalhe, 'ANE · cofre');
assert.deepEqual(detectarEstoque([{ name: 'Mussarela', stock: 2, threshold: 5 }, { name: 'Calabresa', stock: null, threshold: 3 }]).map((e) => e.detalhe), ['2 em estoque · mínimo 5', 'mínimo 3']);

// -- tempo relativo
assert.equal(tempoRelativo(AGORA, AGORA), 'agora');
assert.equal(tempoRelativo(AGORA - 3 * 60000, AGORA), 'há 3 min');
assert.equal(tempoRelativo(AGORA - 125 * 60000, AGORA), 'há 2 h');
assert.equal(tempoRelativo(AGORA - 50 * 3600e3, AGORA), 'há 2 d');
assert.equal(tempoRelativo(AGORA + 5000, AGORA), 'agora', 'relógio adiantado não vira negativo');
console.log('notificacoes: ok');
