// rodar com: npx tsx scripts/testes/tempoPedido.test.ts
import assert from 'node:assert/strict';
process.env.TZ = 'America/Sao_Paulo'; // fixa o fuso: as horas esperadas são de Brasília
import { descreverHoraDoPedido } from '../../lib/tempo';
const agora = new Date('2026-09-29T19:35:00-03:00');
assert.equal(descreverHoraDoPedido('2026-09-29T19:23:00-03:00', agora), '19:23 · há 12 min');
assert.equal(descreverHoraDoPedido('2026-09-29T19:34:40-03:00', agora), '19:34 · agora');
assert.equal(descreverHoraDoPedido('2026-09-29T18:30:00-03:00', agora), '18:30 · há 1 h 5 min');
assert.equal(descreverHoraDoPedido('2026-09-29T17:35:00-03:00', agora), '17:35 · há 2 h');
assert.equal(descreverHoraDoPedido('2026-09-28T23:40:00-03:00', agora), '28/09 23:40', 'de ontem: data + hora, sem "há 1200 min"');
assert.equal(descreverHoraDoPedido('lixo', agora), '');
assert.equal(descreverHoraDoPedido(undefined, agora), '');
console.log('ok');
