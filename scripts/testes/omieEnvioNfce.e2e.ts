// E2E do registro da NFC-e no Omie (lib/omieEnvioServidor.ts) contra o MOCK do Estoque e a ZZ Laboratório.
// Pré-requisito: node scripts/testes/mock-estoque.mjs 9191 em outra janela. NUNCA toca em outra loja.
// rodar com: npx tsx --env-file=.env.local scripts/testes/omieEnvioNfce.e2e.ts
import { createClient } from '@supabase/supabase-js';
import { enviarNfceAutorizadaAoOmie } from '../../lib/omieEnvioServidor';
import type { IncluirNfcePayload } from '../../lib/omie/nota-fiscal';

const ZZ = 'f33b4310-ff0a-487c-a3b1-62acd0a58850';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let falhas = 0;
const passo = (nome: string, ok: boolean, extra?: unknown) => { if (!ok) falhas++; console.log(`${ok ? 'OK  ' : 'FALHOU'} ${nome}${!ok ? ' -> ' + JSON.stringify(extra) : ''}`); };
const payload = (chNFe: string): IncluirNfcePayload => ({ chNFe, nNF: 1, serie: 1, dEmi: '2026-10-04', hEmi: '10:00:00', tpAmb: 2, itens: [{ cProd: 'T', xProd: 'Teste', ncm: '21069090', cfop: '5102', qCom: 1, vUnCom: 10 }], pagamentos: [{ tPag: '01', vPag: 10 }], nfceXml: '<x/>', nfceMd5: 'x', nfceProt: '1', vNF: 10 });
const criados: string[] = [];
async function nota(): Promise<string> {
  const { data, error } = await admin.from('fiscal_notas').insert({ store_id: ZZ, modelo: '65', ambiente: 'homologacao', status: 'autorizada', valor_total: 10 }).select('id').single();
  if (error) throw new Error(error.message);
  criados.push(data.id); return data.id;
}
const lerNota = async (id: string) => (await admin.from('fiscal_notas').select('status, omie_status, omie_erro, omie_em').eq('id', id).single()).data as any;

(async () => {
  try {
    await admin.from('store_ntb_estoque_secrets').upsert({ store_id: ZZ, ntb_estoque_url: 'http://localhost:9191', ntb_estoque_api_key: 'chave-mock-estoque', ativo: true }, { onConflict: 'store_id' });
    for (const [prefixo, esperado, trecho] of [['OK00', 'ok', ''], ['ERR0', 'erro', 'NCM inválido'], ['FILA', 'na_fila', 'consumo redundante'], ['SKIP', 'ignorada', 'sem Omie'], ['H500', 'erro', 'Erro interno']] as const) {
      const id = await nota();
      await enviarNfceAutorizadaAoOmie(admin, ZZ, id, payload(prefixo + '0'.repeat(40)));
      const n = await lerNota(id);
      passo(`nota ${prefixo}: omie_status=${esperado}, status fiscal intacto`, n.omie_status === esperado && n.status === 'autorizada' && (trecho ? (n.omie_erro ?? '').includes(trecho) : n.omie_erro === null) && !!n.omie_em, n);
    }
    // chave errada: HTTP 401 do Estoque vira erro visível
    await admin.from('store_ntb_estoque_secrets').update({ ntb_estoque_api_key: 'errada' }).eq('store_id', ZZ);
    let id = await nota();
    await enviarNfceAutorizadaAoOmie(admin, ZZ, id, payload('OK00' + '0'.repeat(40)));
    let n = await lerNota(id);
    passo('chave recusada (401): erro visível na nota', n.omie_status === 'erro' && /Chave de integração inválida/.test(n.omie_erro ?? ''), n);
    // Estoque fora do ar: erro visível
    await admin.from('store_ntb_estoque_secrets').update({ ntb_estoque_url: 'http://127.0.0.1:9292', ntb_estoque_api_key: 'chave-mock-estoque' }).eq('store_id', ZZ);
    id = await nota();
    await enviarNfceAutorizadaAoOmie(admin, ZZ, id, payload('OK00' + '0'.repeat(40)));
    n = await lerNota(id);
    passo('Estoque fora do ar: erro visível na nota', n.omie_status === 'erro' && !!n.omie_erro, n);
    // loja sem Estoque nem Omie direto: nada a registrar, não é erro
    await admin.from('store_ntb_estoque_secrets').delete().eq('store_id', ZZ);
    id = await nota();
    const r = await enviarNfceAutorizadaAoOmie(admin, ZZ, id, payload('OK00' + '0'.repeat(40)));
    n = await lerNota(id);
    passo('loja sem Omie: nada registrado e sem erro', r === null && n.omie_status === null, n);
  } catch (e) { falhas++; console.error(e); }
  finally {
    if (criados.length) await admin.from('fiscal_notas').delete().in('id', criados);
    await admin.from('store_ntb_estoque_secrets').delete().eq('store_id', ZZ);
    console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CENARIOS PASSARAM');
    process.exit(falhas ? 1 : 0);
  }
})();
