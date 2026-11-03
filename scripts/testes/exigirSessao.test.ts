// rodar com: npx tsx scripts/testes/exigirSessao.test.ts
import assert from 'node:assert/strict';
import { lerTokens, sessaoValePara } from '../../lib/server/sessaoRegra';

const T1 = 'a'.repeat(64);
const T2 = 'b'.repeat(64);

// cabeçalho: um ou dois tokens separados por vírgula; lixo é ignorado
assert.deepEqual(lerTokens(null), []);
assert.deepEqual(lerTokens(''), []);
assert.deepEqual(lerTokens(T1), [T1]);
assert.deepEqual(lerTokens(` ${T1} , ${T2} `), [T1, T2]);
assert.deepEqual(lerTokens(`${T1},xx,' or 1=1`), [T1], 'só hex de tamanho de token');
assert.equal(lerTokens(['a', 'b', 'c', 'd', 'e'].map((c) => c.repeat(64)).join(',')).length, 3, 'no máximo 3');
assert.deepEqual(lerTokens(`${T1},${T1}`), [T1], 'sem repetir');

const agora = new Date('2026-11-02T12:00:00Z');
const futuro = '2026-11-20T00:00:00Z';
const passado = '2026-11-01T00:00:00Z';
const LOJA = '11111111-1111-1111-1111-111111111111';
const OUTRA = '22222222-2222-2222-2222-222222222222';

// sessão da loja certa vale
assert.equal(sessaoValePara([{ tipo: 'loja', store_id: LOJA, expira_em: futuro }], LOJA, agora), true);
// sessão de outra loja não vale
assert.equal(sessaoValePara([{ tipo: 'loja', store_id: OUTRA, expira_em: futuro }], LOJA, agora), false);
// vencida não vale
assert.equal(sessaoValePara([{ tipo: 'loja', store_id: LOJA, expira_em: passado }], LOJA, agora), false);
// Master e conta universal valem em qualquer loja
assert.equal(sessaoValePara([{ tipo: 'admin', store_id: null, expira_em: futuro }], LOJA, agora), true);
assert.equal(sessaoValePara([{ tipo: 'universal', store_id: null, expira_em: futuro }], LOJA, agora), true);
// sem loja alvo: só Master/universal
assert.equal(sessaoValePara([{ tipo: 'loja', store_id: LOJA, expira_em: futuro }], null, agora), false);
assert.equal(sessaoValePara([{ tipo: 'admin', store_id: null, expira_em: futuro }], null, agora), true);
// basta uma das sessões valer (lojista de outra loja + Master no mesmo navegador)
assert.equal(sessaoValePara([
  { tipo: 'loja', store_id: OUTRA, expira_em: futuro },
  { tipo: 'admin', store_id: null, expira_em: futuro },
], LOJA, agora), true);
// nenhuma sessão
assert.equal(sessaoValePara([], LOJA, agora), false);

console.log('exigirSessao: ok');
