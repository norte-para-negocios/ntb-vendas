import assert from 'node:assert/strict';
import { agrupar } from '../../lib/agrupar';
import { fundirDisponibilidade } from '../../lib/disponibilidade';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let n = 0;
  const f = agrupar(() => { n++; }, 800);
  for (let i = 0; i < 10; i++) { f(); await espera(10); }
  assert.equal(n, 0);
  await espera(850);
  assert.equal(n, 1, '10 chamadas em 100 ms = 1 execução');
  f(); await espera(850);
  assert.equal(n, 2, 'nova chamada depois da janela executa de novo');
  f(); f.cancelar(); await espera(850);
  assert.equal(n, 2, 'cancelar não executa');

  const ps = [{ id: 'a', sold_out: false }, { id: 'b', sold_out: false }, { id: 'c', sold_out: true }];
  assert.equal(fundirDisponibilidade(ps, [{ id: 'a', available: true, sold_out: false }]), ps, 'sem mudança = mesma referência');
  const r = fundirDisponibilidade(ps, [{ id: 'a', available: true, sold_out: true }, { id: 'b', available: false, sold_out: false }, { id: 'c', available: true, sold_out: false }]);
  assert.deepEqual(r, [{ id: 'a', sold_out: true }, { id: 'c', sold_out: false }]);
  console.log('ok agrupar/disponibilidade');
})();
