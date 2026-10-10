// rodar com: npx tsx scripts/testes/baixaComNotaSemMarca.test.ts
// Venda fechada sem internet chega sem `emitir_nota` e a baixa roda segundos ANTES da nota existir. Sem marca,
// vale a regra da emissão automática: loja que emite manda a baixa como PDV (comNota), menos venda só cortesia.
// Sertão, 08/10/2026: 4 vendas com nota autorizada (151-154) foram ao Omie como "Movimento Manual de Estoque".
import assert from 'node:assert/strict';
import { montarPayloadsPorPedido } from '../../lib/baixaEstoqueServidor';

type Tabelas = Record<string, unknown>;
function adminFalso(t: Tabelas) {
  return {
    from(tabela: string) {
      const dados = t[tabela];
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'not', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: Array.isArray(dados) ? dados[0] ?? null : dados ?? null, error: null });
      q.then = (ok: (v: unknown) => void) => ok({ data: Array.isArray(dados) ? dados : dados ? [dados] : [], error: null });
      return q;
    },
  } as never;
}

const item = (order_id: string) => ({ order_id, quantity: 1, status: 'delivered', price_at_time: 10, selected_options: null,
  product: { omie_codigo: '90123', destination: 'kitchen', sector_id: null, category_id: null, ignore_category_sector: false, fee_type: null } });

async function comNota(pd: Record<string, unknown> | null, modelo: string, notas: unknown[] = []) {
  const admin = adminFalso({
    order_items: [item('o1')], fiscal_notas: notas, print_sectors: [], categories: [], store_estoque_locais: [],
    stores: { config: {} }, products: null, orders: [{ id: 'o1', order_type: 'table', customer_name: null, table: { number: 3 } }],
    store_fiscal_config: { modelo_emissao_automatica: modelo, ambiente: 'producao' },
  });
  const r = await montarPayloadsPorPedido(admin, 's1', [{ id: 'o1', payment_details: pd }]);
  return r.get('o1')!.payload.itens[0].comNota;
}

(async () => {
  const dinheiro = { methods: [{ method: 'CASH', amount: 10 }] };
  assert.equal(await comNota(dinheiro, 'nfce'), true, 'sem marca + loja com NFC-e automática = PDV');
  assert.equal(await comNota(dinheiro, 'nenhuma'), false, 'sem marca + loja sem emissão = baixa comum');
  assert.equal(await comNota({ methods: [{ method: 'COURTESY', amount: 10 }] }, 'nfce'), false, 'só cortesia não tem nota');
  assert.equal(await comNota({ ...dinheiro, emitir_nota: false }, 'nfce'), false, 'opt-out explícito vale');
  assert.equal(await comNota({ ...dinheiro, emitir_nota: true }, 'nenhuma'), true, 'marca explícita vale');
  assert.equal(await comNota(dinheiro, 'nenhuma', [{ order_id: 'o1', status: 'autorizada' }]), true, 'nota já existente vale');
  console.log('ok baixaComNotaSemMarca');
})();
