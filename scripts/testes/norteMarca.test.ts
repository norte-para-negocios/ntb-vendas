// rodar com: npx tsx scripts/testes/norteMarca.test.ts
import assert from 'node:assert/strict';
import { NORTE_SIMBOLO_SVG } from '../../lib/reports/norteMarca';
assert.ok(NORTE_SIMBOLO_SVG.startsWith('<svg'), 'é um svg');
assert.ok(NORTE_SIMBOLO_SVG.includes('viewBox='), 'tem viewBox');
assert.ok(!NORTE_SIMBOLO_SVG.includes('<rect'), 'sem quadrado de fundo');
assert.ok(NORTE_SIMBOLO_SVG.includes('#484DB5'), 'na cor da marca');
assert.ok(!/<script|onload|href=/i.test(NORTE_SIMBOLO_SVG), 'sem script/links');
assert.ok(NORTE_SIMBOLO_SVG.length < 8000, 'pequeno o bastante para ir no bundle');
console.log('norteMarca: ok');
