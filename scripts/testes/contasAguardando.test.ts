// rodar com: npx tsx scripts/testes/contasAguardando.test.ts
import assert from 'node:assert/strict';
import { separarContasAguardando, contasDaMesa, idDaMesaFisica, podeLiberarMesa, ehContaAguardando } from '../../lib/contasAguardando';

type T = { id: string; status: string; standby?: boolean; standby_de?: string | null; standby_em?: string | null };
const lista: T[] = [
  { id: 'm1', status: 'occupied' },
  { id: 'm2', status: 'available' },
  { id: 'c1', status: 'standby', standby: true, standby_de: 'm1', standby_em: '2026-10-07T20:10:00Z' },
  { id: 'c0', status: 'standby', standby: true, standby_de: 'm1', standby_em: '2026-10-07T19:00:00Z' },
  { id: 'cx', status: 'closed', standby: true, standby_de: 'm2' }, // já recebida: some
];

const { mesas, contas } = separarContasAguardando<any>(lista);
assert.deepEqual(mesas.map((t) => t.id), ['m1', 'm2'], 'mapa só com mesas físicas');
assert.deepEqual(contas.map((t) => t.id), ['c1', 'c0'], 'só contas em aberto');
assert.deepEqual(contasDaMesa<any>(contas, 'm1').map((t) => t.id), ['c0', 'c1'], 'mais antiga primeiro');
assert.equal(contasDaMesa<any>(contas, 'm2').length, 0);
assert.equal(idDaMesaFisica(lista[2] as any), 'm1', 'jurisdição pela mesa física');
assert.equal(idDaMesaFisica(lista[0] as any), 'm1');
assert.equal(ehContaAguardando(lista[0] as any), false);
assert.equal(podeLiberarMesa({ status: 'waiting_bill' } as any, true), true);
assert.equal(podeLiberarMesa({ status: 'occupied' } as any, true), true);
assert.equal(podeLiberarMesa({ status: 'occupied' } as any, false), false, 'sem conta não libera');
assert.equal(podeLiberarMesa({ status: 'available' } as any, true), false);
assert.equal(podeLiberarMesa({ status: 'standby', standby: true } as any, true), false, 'conta aguardando não libera de novo');
console.log('contasAguardando: ok');
