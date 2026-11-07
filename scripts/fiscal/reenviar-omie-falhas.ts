// Reenvio automático ao Omie das NFC-e autorizadas cujo envio falhou por motivo passageiro (Estoque reiniciando, rede,
// Omie lento ou bloqueado). Antes (até 07/11/2026) ninguém reenviava: 2 notas do Sertão ficaram fora do Omie por um 502.
// Recusa de conteúdo (produto sem código no Omie etc.) não é reenviada: aparece na conferência diária.
// No servidor roda empacotado (esbuild) pelo cron, ver scripts/servidor/README-omie.md. Local:
//   npx tsx --env-file=.env.local scripts/fiscal/reenviar-omie-falhas.ts [--seco]
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { payloadOmieDoNfeProc } from '../../lib/fiscal/payloadOmieDoXml';
import { enviarNfceAutorizadaAoOmie } from '../../lib/omieEnvioServidor';
import { ehFalhaPassageiraOmie } from '../../lib/omieEnvio';

async function main() {
  const seco = process.argv.includes('--seco');
  const admin = getSupabaseAdmin();
  const desde = new Date(Date.now() - 3 * 86400000).toISOString();
  const ate = new Date(Date.now() - 15 * 60000).toISOString();
  const { data: notas, error } = await admin
    .from('fiscal_notas')
    .select('id, store_id, serie, numero, xml_path, omie_erro')
    .eq('status', 'autorizada')
    .eq('omie_status', 'erro')
    .gte('created_at', desde)
    .lte('omie_em', ate)
    .not('xml_path', 'is', null)
    .order('created_at')
    .limit(20);
  if (error) throw new Error(error.message);
  const alvo = (notas ?? []).filter((n) => ehFalhaPassageiraOmie(n.omie_erro));
  const taxaPorLoja = new Map<string, string | null>();
  for (const n of alvo) {
    if (seco) { console.log('[seco]', n.serie, n.numero, n.omie_erro); continue; }
    if (!taxaPorLoja.has(n.store_id)) {
      const { data: taxa } = await admin.from('products').select('omie_codigo').eq('store_id', n.store_id).eq('fee_type', 'percent').not('omie_codigo', 'is', null).limit(1).maybeSingle();
      taxaPorLoja.set(n.store_id, taxa?.omie_codigo ?? null);
    }
    const { data: arq, error: e } = await admin.storage.from('fiscal-documentos').download(n.xml_path as string);
    if (e || !arq) { console.log(new Date().toISOString(), n.serie, n.numero, 'falha ao baixar XML', e?.message); continue; }
    const payload = payloadOmieDoNfeProc(await arq.text(), { codigoTaxa: taxaPorLoja.get(n.store_id) });
    const r = await enviarNfceAutorizadaAoOmie(admin, n.store_id, n.id, payload);
    console.log(new Date().toISOString(), `série ${n.serie} nº ${n.numero}`, '→', r?.status ?? 'sem integração', r?.erro ?? '');
    await new Promise((res) => setTimeout(res, 3000));
  }
}
main().catch((e) => { console.error(new Date().toISOString(), e); process.exit(1); });
