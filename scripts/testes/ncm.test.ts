// rodar com: npx tsx scripts/testes/ncm.test.ts
import assert from 'node:assert/strict';
import { normalizarNcm } from '../../lib/fiscal/ncm';

assert.equal(normalizarNcm('22030000'), '22030000');
assert.equal(normalizarNcm('2203.00.00'), '22030000');
assert.equal(normalizarNcm('2203.00.00 CERVEJAS DE MALTE 22030000'), '22030000'); // texto do Omie (caso real 03/10)
assert.equal(normalizarNcm('3923.21.90 OUTS.SACOS,BOLSAS E CARTUCHOS,DE POLIMEROS DE ETILENO 39232190'), '39232190');
assert.equal(normalizarNcm(' 2202 10 00 '), '22021000');
assert.equal(normalizarNcm('1234567'), null); // 7 dígitos
assert.equal(normalizarNcm(''), null);
assert.equal(normalizarNcm(null), null);
assert.equal(normalizarNcm(undefined), null);
console.log('ncm: ok');
