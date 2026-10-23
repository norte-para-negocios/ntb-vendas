// rodar com: npx tsx scripts/testes/sessaoCardapio.test.ts
// 22/10/2026 (reunião 21/10): sessão salva da mesa 1 voltava sozinha e o "Confirmar" mandava para ela.
import assert from 'node:assert/strict';
import { lerSessaoSalva, decidirRestauracao, montarSessaoSalva, textoConfirmarSessao, SESSAO_VALIDADE_MS } from '../../lib/sessaoCardapio';

const agora = 1_800_000_000_000;
const mesaA = (host: string | null, status = 'occupied') => ({ status, current_host_name: host });

// Leitura tolerante
assert.equal(lerSessaoSalva(null), null);
assert.equal(lerSessaoSalva('{quebrado'), null);
assert.equal(lerSessaoSalva('{"tableId":"x"}'), null, 'sem nome/timestamp não vale');

// Sessão nova (com hostName) só volta na MESMA ocupação
const s = montarSessaoSalva({ name: 'Ana', tableId: 't1', hostPin: '1234', hostName: 'Ana', agora });
assert.equal(s.mode, 'table');
assert.deepEqual(lerSessaoSalva(JSON.stringify(s)), s);
assert.equal(decidirRestauracao(s, mesaA('Ana'), agora + 1000), 'restaurar');
assert.equal(decidirRestauracao(s, mesaA('  ana '), agora + 1000), 'restaurar', 'maiúscula/espaço não contam');
assert.equal(decidirRestauracao(s, mesaA('Bruno'), agora + 1000), 'descartar', 'mesa reaberta por outro grupo: nunca mostrar os pedidos deles');
assert.equal(decidirRestauracao(s, mesaA(null), agora + 1000), 'descartar');
assert.equal(decidirRestauracao(s, mesaA('Ana', 'waiting_bill'), agora + 1000), 'restaurar');
assert.equal(decidirRestauracao(s, mesaA('Ana', 'available'), agora + 1000), 'descartar');
assert.equal(decidirRestauracao(s, undefined, agora + 1000), 'descartar', 'mesa sumiu');
assert.equal(decidirRestauracao(s, mesaA('Ana'), agora + SESSAO_VALIDADE_MS), 'descartar', 'venceu 4 h');

// Convidado (não anfitrião): grava o anfitrião da mesa, não o próprio nome
const conv = montarSessaoSalva({ name: 'Carla', tableId: 't1', hostPin: null, hostName: 'Ana', agora });
assert.equal(decidirRestauracao(conv, mesaA('Ana'), agora + 1), 'restaurar');

// Mesa aberta pela equipe sem anfitrião: null == null continua valendo
const semHost = montarSessaoSalva({ name: 'Davi', tableId: 't1', hostPin: null, hostName: null, agora });
assert.equal(decidirRestauracao(semHost, mesaA(null), agora + 1), 'restaurar');

// Sessão antiga (sem hostName): continua voltando (com a confirmação no 1º envio)
const antiga = { name: 'Ana', tableId: 't1', mode: 'table' as const, timestamp: agora };
assert.equal(decidirRestauracao(antiga, mesaA('Outro'), agora + 1), 'restaurar');

// Balcão
const balcao = montarSessaoSalva({ name: 'Eva', tableId: null, hostPin: '9', hostName: 'x', agora });
assert.equal(balcao.mode, 'counter');
assert.equal(balcao.hostPin, null);
assert.equal(balcao.hostName, null);
assert.equal(decidirRestauracao(balcao, undefined, agora + 1), 'restaurar');

// Texto
const t = textoConfirmarSessao('Ana', 1);
assert.ok(t.title.includes('Mesa 1') && t.message.includes('Ana') && t.cancelLabel === 'Estou em outra mesa');
assert.ok(textoConfirmarSessao('Eva', null).confirmLabel.includes('Balcão'));

console.log('sessaoCardapio: ok');
