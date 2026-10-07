// rodar com: npx tsx scripts/testes/modoEstoqueServidor.test.ts
// Modo de estoque no servidor: 'nenhum' não baixa; NFC-e só vai ao Omie em loja 'omie'.
import assert from 'node:assert/strict';
import { motivoSemBaixa } from '../../lib/modoEstoque';
import { enviarNfceAutorizadaAoOmie } from '../../lib/omieEnvioServidor';

assert.equal(motivoSemBaixa('nenhum'), 'Loja sem controle de estoque');
assert.equal(motivoSemBaixa('omie'), null);
assert.equal(motivoSemBaixa('proprio'), null);
assert.equal(motivoSemBaixa(undefined), null, 'banco antigo (sem coluna) = omie = baixa como sempre');

// admin falso: stores.stock_mode, store_ntb_estoque_secrets (ativo) e update de fiscal_notas.
function adminFalso(stockMode: unknown) {
  const registros: { tabela: string; op: string }[] = [];
  const admin = {
    from(tabela: string) {
      registros.push({ tabela, op: 'from' });
      const q: any = {
        select: () => q, eq: () => q, update: () => { registros.push({ tabela, op: 'update' }); return q; },
        maybeSingle: async () => {
          if (tabela === 'stores') return { data: stockMode === undefined ? null : { stock_mode: stockMode } };
          if (tabela === 'store_ntb_estoque_secrets') return { data: { ntb_estoque_url: 'http://estoque.teste', ntb_estoque_api_key: 'k', ativo: true } };
          return { data: null };
        },
        then: (res: (v: unknown) => void) => res({ error: null }),
      };
      return q;
    },
  };
  return { admin: admin as any, registros };
}

const payload: any = { itens: [] };
const fetchOriginal = globalThis.fetch;
let chamadas = 0;
globalThis.fetch = (async () => { chamadas++; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;

(async () => {
  try {
    // Estoque próprio e sem estoque: nunca falam com o Estoque/Omie para registrar a NFC-e, e não gravam status do Omie na nota.
    for (const modo of ['proprio', 'nenhum']) {
      chamadas = 0;
      const { admin, registros } = adminFalso(modo);
      const r = await enviarNfceAutorizadaAoOmie(admin, 'loja-1', 'nota-1', payload);
      assert.equal(r, null, `${modo}: nada a registrar`);
      assert.equal(chamadas, 0, `${modo}: nenhuma chamada de rede`);
      assert.ok(!registros.some((x) => x.op === 'update'), `${modo}: não grava status do Omie`);
    }
    // Regressão: loja Omie (e banco antigo sem a coluna) seguem o caminho de sempre, com a chamada ao Estoque.
    for (const modo of ['omie', undefined]) {
      chamadas = 0;
      const { admin } = adminFalso(modo);
      await enviarNfceAutorizadaAoOmie(admin, 'loja-1', 'nota-1', payload);
      assert.equal(chamadas, 1, `${String(modo)}: chama o Estoque como sempre`);
    }
    console.log('modoEstoqueServidor: ok');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
})().catch((e) => { console.error(e); process.exit(1); });
