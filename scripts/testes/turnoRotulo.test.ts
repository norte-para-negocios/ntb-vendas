// rodar com: npx tsx scripts/testes/turnoRotulo.test.ts
import assert from 'node:assert/strict';
import { abertoDesde } from '../../lib/turnoRotulo';

const agora = new Date(2026, 9, 4, 14, 0); // 04/10 14:00 (relógio local)
assert.equal(abertoDesde(new Date(2026, 9, 4, 8, 5).toISOString(), agora), '08:05', 'de hoje: só a hora');
assert.equal(abertoDesde(new Date(2026, 9, 3, 20, 5).toISOString(), agora), '03/10 20:05', 'ontem à noite, menos de 24h: data sem "há"');
assert.equal(abertoDesde(new Date(2026, 8, 9, 20, 5).toISOString(), agora), '09/09 20:05 (há 24 dias)', 'esquecido aberto: data e dias');
console.log('turnoRotulo: ok');
