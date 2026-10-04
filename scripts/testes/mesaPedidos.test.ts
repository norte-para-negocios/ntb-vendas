// rodar com: npx tsx scripts/testes/mesaPedidos.test.ts
import assert from 'node:assert/strict';
import { resumirPedidosDaMesa } from '../../lib/mesaPedidos';

const it = (id: string, nome: string, qtd: number, preco: number, status = 'pending', extra: any = {}) =>
  ({ id, quantity: qtd, price_at_time: preco, status, added_by_name: 'ANE', product: { name: nome, fee_type: null }, selected_options: [], ...extra });

const r = resumirPedidosDaMesa([
  it('1', 'Heineken 330ml', 2, 16.9),
  it('2', 'Pizza Tradicional', 1, 104.9, 'preparing', { selected_options: [{ name: 'Grande' }, { name: 'Calabresa' }] }),
  it('3', 'Água 350ml', 1, 5.4, 'canceled'),                                   // Review Focus 4: cancelado não soma
  it('4', 'Taxa de Serviço (10%)', 1, 13.9, 'delivered', { product: { name: 'Taxa de Serviço (10%)', fee_type: 'percent' } }),
]);
assert.equal(r.linhas.length, 4);
assert.equal(r.total, 2 * 16.9 + 104.9 + 13.9, 'cancelado fora do total');
assert.equal(r.linhas[1].nome, 'Pizza Tradicional · Grande, Calabresa', 'opções junto do nome');
assert.equal(r.linhas.find((l) => l.id === '3')!.status, 'canceled');
assert.equal(r.linhas.find((l) => l.id === '4')!.taxa, true);
assert.deepEqual(resumirPedidosDaMesa([]), { linhas: [], total: 0 });
console.log('mesaPedidos: ok');
