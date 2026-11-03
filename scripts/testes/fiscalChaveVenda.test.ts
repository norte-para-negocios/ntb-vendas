// rodar com: npx tsx scripts/testes/fiscalChaveVenda.test.ts
// Trava de emissão por VENDA (não pelo corpo da requisição): {tableId} e {orderId} da mesma venda pegam a mesma trava.
import assert from 'node:assert/strict';
import { chaveDaVendaResolvida, ordenarPedidosDaVenda } from '../../lib/fiscal/chaveVenda';

const a = { id: 'a', created_at: '2026-11-03T20:00:00.000Z' };
const b = { id: 'b', created_at: '2026-11-03T20:05:00.000Z' };

// 1. Ordem de entrada não importa.
assert.equal(
  chaveDaVendaResolvida({ storeId: 's1', pedidos: [b, a], pessoa: null }),
  chaveDaVendaResolvida({ storeId: 's1', pedidos: [a, b], pessoa: null }),
);
assert.equal(chaveDaVendaResolvida({ storeId: 's1', pedidos: [a, b], pessoa: null }), 'venda|s1|a|');

// 2. Pessoa muda a chave (nota por pessoa não trava a 2ª pessoa).
assert.notEqual(
  chaveDaVendaResolvida({ storeId: 's1', pedidos: [a, b], pessoa: 'Ana' }),
  chaveDaVendaResolvida({ storeId: 's1', pedidos: [a, b], pessoa: 'Bia' }),
);
assert.notEqual(
  chaveDaVendaResolvida({ storeId: 's1', pedidos: [a, b], pessoa: 'Ana' }),
  chaveDaVendaResolvida({ storeId: 's1', pedidos: [a, b], pessoa: null }),
);
assert.equal(chaveDaVendaResolvida({ storeId: 's1', pedidos: [a], pessoa: '  Ana ' }), 'venda|s1|a|Ana');
assert.equal(chaveDaVendaResolvida({ storeId: 's1', pedidos: [a], pessoa: '   ' }), 'venda|s1|a|');

// 3. Fechamento por {tableId} (todos os pedidos da mesa) e reemissão por {orderId} da âncora = mesma chave.
const porMesa = chaveDaVendaResolvida({ storeId: 's1', pedidos: [b, a], pessoa: null });
const porPedido = chaveDaVendaResolvida({ storeId: 's1', pedidos: [a], pessoa: null });
assert.equal(porMesa, porPedido);

// 4. Empate de created_at desempata por id (âncora estável entre duas execuções).
const c1 = { id: 'z', created_at: '2026-11-03T20:00:00.000Z' };
const c2 = { id: 'm', created_at: '2026-11-03T20:00:00.000Z' };
assert.deepEqual(ordenarPedidosDaVenda([c1, c2]).map((p) => p.id), ['m', 'z']);
assert.deepEqual(ordenarPedidosDaVenda([c2, c1]).map((p) => p.id), ['m', 'z']);
// created_at com microssegundos (string do Postgres) e formatos diferentes ordenam por instante.
assert.deepEqual(
  ordenarPedidosDaVenda([
    { id: 'x', created_at: '2026-11-03 20:00:01.5+00' },
    { id: 'y', created_at: '2026-11-03T17:00:00.900-03:00' },
  ]).map((p) => p.id),
  ['y', 'x'],
);

// 5. Loja diferente = chave diferente; sem pedido = null.
assert.notEqual(
  chaveDaVendaResolvida({ storeId: 's1', pedidos: [a], pessoa: null }),
  chaveDaVendaResolvida({ storeId: 's2', pedidos: [a], pessoa: null }),
);
assert.equal(chaveDaVendaResolvida({ storeId: 's1', pedidos: [], pessoa: null }), null);
assert.equal(chaveDaVendaResolvida({ storeId: '', pedidos: [a], pessoa: null }), null);

console.log('fiscalChaveVenda: ok');
