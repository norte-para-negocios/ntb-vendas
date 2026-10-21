// rodar com: npx tsx scripts/testes/pedirConta.test.ts
// "Pedir conta" do garçom (21/10/2026, ODARA: a mesa virava "Pediu conta" e a comanda saía a cada pedido lançado).
import assert from 'node:assert/strict';
import { podePedirConta, textoConfirmarConta, TRAVA_TOQUE_MS } from '../../lib/pedirConta';

assert.equal(TRAVA_TOQUE_MS, 900);
assert.equal(podePedirConta(1000, 500), false, 'toque logo depois de fechar o cardápio não conta');
assert.equal(podePedirConta(1399, 500), false);
assert.equal(podePedirConta(1400, 500), true, '900 ms depois já vale');
assert.equal(podePedirConta(1000, null), true, 'sem cardápio fechado recente, vale');
assert.equal(podePedirConta(1000, 900, 50), true, 'trava configurável');

const comPapel = textoConfirmarConta(4, true);
assert.equal(comPapel.title, 'Pedir a conta da mesa 4?');
assert.equal(comPapel.confirmLabel, 'Pedir conta');
assert.ok(comPapel.message.startsWith('A mesa fica como Pediu conta e só o caixa consegue reabrir.'));
assert.ok(comPapel.message.endsWith('A comanda sai na impressora.'));
const semPapel = textoConfirmarConta('12', false);
assert.equal(semPapel.title, 'Pedir a conta da mesa 12?');
assert.ok(!semPapel.message.includes('comanda'));
console.log('pedirConta: ok');
