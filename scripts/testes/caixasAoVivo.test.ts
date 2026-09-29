// rodar com: npx tsx scripts/testes/caixasAoVivo.test.ts
import assert from 'node:assert/strict';
import { agruparOperadores, nomeDoOperador, tempoAberto, podeVerCaixasDaEquipe } from '../../lib/caixasAoVivo';

const aberto = (id: string, nome: string | null, opened_at: string) => ({ id, store_id: 's', operator_user_id: 'u', opened_at, closed_at: null, opening_float: 100, closing_counted_cash: null, closing_cash_breakdown: null, approved_by_user_id: null, status: 'open' as const, notes: null, operator_name: nome });
const hist = (id: string, nome: string | null, opened_at: string) => ({ id, opened_at, closed_at: null, opening_float: 0, closing_counted_cash: null, status: 'closed' as const, notes: null, operator_name: nome, difference: 0 });

assert.equal(nomeDoOperador(null), 'Conta universal');
assert.equal(nomeDoOperador('  '), 'Conta universal');
assert.equal(nomeDoOperador(' Ana '), 'Ana');

const r = agruparOperadores(
  [aberto('a1', 'Zeca', '2026-09-29T10:00:00Z'), aberto('a2', null, '2026-09-29T11:00:00Z')],
  [hist('h1', 'Ana', '2026-09-20T10:00:00Z'), hist('h2', 'Ana', '2026-09-25T10:00:00Z'), hist('h3', 'Zeca', '2026-09-28T10:00:00Z')],
);
assert.deepEqual(r.map(o => o.nome), ['Conta universal', 'Zeca', 'Ana']);
assert.equal(r[2].aberto, null);
assert.deepEqual(r[2].historico.map(h => h.id), ['h2', 'h1']);

const base = Date.parse('2026-09-29T12:05:00Z');
assert.equal(tempoAberto('2026-09-29T12:00:00Z', base).texto, '5 min');
assert.equal(tempoAberto('2026-09-29T10:00:00Z', base).texto, '2 h 05 min');
assert.equal(tempoAberto('2026-09-28T09:05:00Z', base).texto, '1 d 3 h');
assert.equal(tempoAberto('2026-09-28T09:05:00Z', base).esquecido, true);
assert.equal(tempoAberto('2026-09-29T10:00:00Z', base).esquecido, false);

assert.equal(podeVerCaixasDaEquipe({ role: 'owner' }), true);
assert.equal(podeVerCaixasDaEquipe({ role: 'manager' }), true);
assert.equal(podeVerCaixasDaEquipe({ role: 'universal' }), true);
assert.equal(podeVerCaixasDaEquipe({ role: 'waiter', permissions: { supervisiona_caixa: true } }), true);
assert.equal(podeVerCaixasDaEquipe({ role: 'waiter', permissions: { caixa: true } }), false);
assert.equal(podeVerCaixasDaEquipe({ role: 'waiter' }), false);
console.log('ok');
