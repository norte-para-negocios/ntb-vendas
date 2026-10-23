// rodar com: npx tsx scripts/testes/cancelamentoLivre.test.ts
// 22/10/2026 (reunião 21/10): tempo livre de cancelamento e cancelar parte de um item.
import assert from 'node:assert/strict';
import { minutosLivres, dentroDoTempoLivre, limitarQuantidade } from '../../lib/cancelamentoLivre';

const agora = Date.parse('2026-10-22T15:00:00Z');
const ha = (s: number) => new Date(agora - s * 1000).toISOString();

assert.equal(minutosLivres(undefined), 0);
assert.equal(minutosLivres({}), 0);
assert.equal(minutosLivres({ cancel_free_minutes: 0 }), 0);
assert.equal(minutosLivres({ cancel_free_minutes: '2' }), 2);
assert.equal(minutosLivres({ cancel_free_minutes: -3 }), 0);
assert.equal(minutosLivres({ cancel_free_minutes: 999 }), 60);

const cfg = { cancel_free_minutes: 1 };
assert.equal(dentroDoTempoLivre([{ created_at: ha(20) }], cfg, agora), true, '20 s dentro de 1 min');
assert.equal(dentroDoTempoLivre([{ created_at: ha(50) }], cfg, agora), false, 'margem de 15 s pede senha');
assert.equal(dentroDoTempoLivre([{ created_at: ha(20) }, { created_at: ha(3600) }], cfg, agora), false, 'um velho = senha');
assert.equal(dentroDoTempoLivre([{ created_at: ha(5) }], {}, agora), false, 'sem config = sempre senha');
assert.equal(dentroDoTempoLivre([{ created_at: null }], cfg, agora), false);
assert.equal(dentroDoTempoLivre([], cfg, agora), false);

assert.equal(limitarQuantidade(0, 4), 1);
assert.equal(limitarQuantidade(3, 4), 3);
assert.equal(limitarQuantidade(9, 4), 4);
assert.equal(limitarQuantidade(NaN, 4), 4);
console.log('cancelamentoLivre: ok');
