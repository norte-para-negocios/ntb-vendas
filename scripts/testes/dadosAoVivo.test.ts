// rodar com: npx tsx scripts/testes/dadosAoVivo.test.ts
import assert from 'node:assert/strict';
import { publicarMesas, publicarKds, mesasRecentes, kdsRecente, aoPublicar, limparDadosAoVivo } from '../../lib/dadosAoVivo';

limparDadosAoVivo();
assert.equal(mesasRecentes('L1', 10000), null, 'sem publicação não há dado');
let avisos = 0;
const parar = aoPublicar(() => { avisos++; });
publicarMesas('L1', [{ id: 'm1' }]);
assert.equal(avisos, 1);
assert.deepEqual(mesasRecentes('L1', 10000), [{ id: 'm1' }]);
assert.equal(mesasRecentes('L2', 10000), null, 'dado de outra loja não vaza');
assert.equal(mesasRecentes('L1', 10000, Date.now() + 20000), null, 'dado velho não serve');
publicarKds('L1', 'kitchen', [{ id: 'i1' }]);
assert.deepEqual(kdsRecente('L1', 'kitchen', 10000), [{ id: 'i1' }]);
assert.equal(kdsRecente('L1', 'bar', 10000), null, 'bases separadas');
parar();
publicarMesas('L1', []);
assert.equal(avisos, 2, 'depois de cancelar não avisa mais');
console.log('dadosAoVivo: ok');
