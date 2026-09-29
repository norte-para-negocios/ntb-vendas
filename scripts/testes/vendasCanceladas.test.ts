// rodar com: npx tsx scripts/testes/vendasCanceladas.test.ts
import assert from 'node:assert/strict';
import { valorCancelado, motivoCancelamento, resumoCanceladas, PedidoCancelado } from '../../lib/vendasCanceladas';

const base: PedidoCancelado = { id: 'a', order_type: 'table', customer_name: null, created_at: '2026-09-29T16:39:00Z', updated_at: '2026-09-29T17:42:00Z', total: 48.8, pagamento: null, estornado_por_nota: false, mesa: 1, itens: [], notas: [] };

// valor: usa o total pago (com taxa) quando existe; senão o total do pedido
assert.equal(valorCancelado({ ...base, pagamento: { total: 53.68 } }), 53.68);
assert.equal(valorCancelado(base), 48.8);
assert.equal(valorCancelado({ ...base, total: null as any }), 0);

// motivo
assert.equal(motivoCancelamento(base), 'Pedido cancelado');
assert.equal(motivoCancelamento({ ...base, estornado_por_nota: true, notas: [{ numero: 1, serie: 2, modelo: '65', cancelada_em: null, justificativa: null }] }), 'Nota fiscal cancelada (nº 1)');
assert.equal(motivoCancelamento({ ...base, estornado_por_nota: true, notas: [{ numero: 1, serie: 2, modelo: '65', cancelada_em: null, justificativa: null }, { numero: 2, serie: 2, modelo: '65', cancelada_em: null, justificativa: null }] }), 'Nota fiscal cancelada (nº 1 e 2)');
assert.equal(motivoCancelamento({ ...base, estornado_por_nota: true, notas: [] }), 'Nota fiscal cancelada');

// resumo: quantidade e soma só dos pedidos que tinham pagamento estornado
const r = resumoCanceladas([
  { ...base, pagamento: { total: 53.68 }, estornado_por_nota: true },
  { ...base, id: 'b', total: 10 },
]);
assert.equal(r.quantidade, 2);
assert.equal(Math.round(r.valorTotal * 100), Math.round((53.68 + 10) * 100));
console.log('ok');
