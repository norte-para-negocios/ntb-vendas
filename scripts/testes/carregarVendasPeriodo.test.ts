// rodar com: npx tsx scripts/testes/carregarVendasPeriodo.test.ts
import assert from 'node:assert/strict';
import { carregarVendasPeriodo } from '../../lib/reports/carregarVendasPeriodo';

(async () => {
  let ativos = 0, pico = 0, chamadas = 0;
  const pedido = (id: string) => ({ id, status: 'delivered', order_items: [], payment_details: { payment_id: `p-${id}`, methods: [{ method: 'PIX', amount: 10 }] } }) as any;
  const buscar = async (ini: string) => {
    chamadas++; ativos++; pico = Math.max(pico, ativos);
    await new Promise((r) => setTimeout(r, 5));
    ativos--;
    if (ini.startsWith('2026-10-02')) return Array.from({ length: 2000 }, (_, i) => pedido(`x${i}`));
    if (ini.startsWith('2026-10-01')) return [pedido('a'), pedido('rep')];
    return [pedido('rep'), pedido('b')];
  };
  const r = await carregarVendasPeriodo(buscar, '2026-10-01', '2026-10-10');
  assert.equal(chamadas, 10);
  assert.ok(pico <= 6, `pico ${pico}`);
  assert.equal(r.vendas.filter((v) => v.id === 'rep').length, 1);
  assert.ok(r.vendas.some((v) => v.id === 'a') && r.vendas.some((v) => v.id === 'b'));
  assert.deepEqual(r.diasCortados, ['2026-10-02']);
  const vazio = await carregarVendasPeriodo(async () => [], '2026-10-01', '2026-10-01');
  assert.deepEqual(vazio, { vendas: [], diasCortados: [] });
  console.log('carregarVendasPeriodo: ok');
})();
