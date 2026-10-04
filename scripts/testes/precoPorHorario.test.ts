// rodar com: npx tsx scripts/testes/precoPorHorario.test.ts
// Os mesmos casos foram conferidos contra public.effective_product_price (migration 153) em 04/10.
import assert from 'node:assert/strict';
import { scheduledPrice, type PriceSchedule } from '../../lib/priceSchedule';

const mk = (o: Partial<PriceSchedule>): PriceSchedule => ({
  id: 'x', name: 'hh', product_id: 'p', category_id: null, price: null, discount_percent: 50, days: null,
  time_from: '00:00', time_until: '23:59', timezone: 'America/Bahia', active: true, ...o,
});
const BASE = 24;
const seg1200 = new Date('2026-10-05T12:00:00-03:00'); // segunda 12:00
const seg0100 = new Date('2026-10-05T01:00:00-03:00'); // segunda 01:00

assert.equal(scheduledPrice(BASE, [mk({})], seg1200), 12, '50% o dia todo');
assert.equal(scheduledPrice(BASE, [mk({ discount_percent: null, price: 15 })], seg1200), 15, 'preço fixo');
assert.equal(scheduledPrice(BASE, [mk({ discount_percent: null, price: 30 })], seg1200), 24, 'nunca sobe acima do base');
assert.equal(scheduledPrice(BASE, [mk({ active: false })], seg1200), 24, 'inativa');
assert.equal(scheduledPrice(BASE, [mk({ time_from: '17:00', time_until: '19:00' })], seg1200), 24, 'fora da janela');
assert.equal(scheduledPrice(BASE, [mk({ time_from: '17:00', time_until: '19:00' })], new Date('2026-10-05T18:00:00-03:00')), 12, 'dentro da janela');
assert.equal(scheduledPrice(BASE, [mk({ time_until: '12:00', time_from: '11:00' })], seg1200), 24, 'fim exclusivo');
// virada da meia-noite 22:00-02:00, valendo nos dias em que COMEÇA (domingo=0)
const vira = mk({ time_from: '22:00', time_until: '02:00', days: [0] });
assert.equal(scheduledPrice(BASE, [vira], new Date('2026-10-04T23:00:00-03:00')), 12, 'domingo 23h');
assert.equal(scheduledPrice(BASE, [vira], seg0100), 12, 'segunda 01h ainda é a janela de domingo');
assert.equal(scheduledPrice(BASE, [vira], new Date('2026-10-05T23:00:00-03:00')), 24, 'segunda 23h não vale');
assert.equal(scheduledPrice(BASE, [mk({ time_from: '22:00', time_until: '02:00' })], seg1200), 24, 'meio-dia fora da virada');
// várias regras: vale a menor
assert.equal(scheduledPrice(BASE, [mk({ discount_percent: 10 }), mk({ discount_percent: 50 })], seg1200), 12);
// dia da semana
assert.equal(scheduledPrice(BASE, [mk({ days: [1] })], seg1200), 12, 'segunda');
assert.equal(scheduledPrice(BASE, [mk({ days: [2, 3] })], seg1200), 24, 'só terça/quarta');
console.log('precoPorHorario: ok');
