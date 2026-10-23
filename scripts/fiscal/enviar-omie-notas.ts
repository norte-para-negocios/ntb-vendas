// rodar com: npx tsx --env-file=.env.local scripts/fiscal/enviar-omie-notas.ts <loja-like> <serie> <numero...>
// Manda ao Omie (pelo mesmo caminho da emissão: NTB Estoque ou Omie direto) NFC-e autorizadas que ficaram fora dele,
// montando o envio a partir do nfeProc guardado (lib/fiscal/payloadOmieDoXml.ts). Grava o resultado na nota.
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { payloadOmieDoNfeProc } from '../../lib/fiscal/payloadOmieDoXml';
import { enviarNfceAutorizadaAoOmie } from '../../lib/omieEnvioServidor';

async function main() {
  const [loja, serie, ...numeros] = process.argv.slice(2);
  if (!loja || !serie || !numeros.length) throw new Error('uso: <loja-like> <serie> <numero...>');
  const admin = getSupabaseAdmin();
  const { data: store } = await admin.from('stores').select('id, name').ilike('name', `%${loja}%`).single();
  if (!store) throw new Error('loja não encontrada');
  const { data: taxa } = await admin.from('products').select('omie_codigo').eq('store_id', store.id).eq('fee_type', 'percent').not('omie_codigo', 'is', null).limit(1).maybeSingle();
  for (const num of numeros.map(Number)) {
    const { data: n } = await admin.from('fiscal_notas').select('id, status, xml_path, ambiente').eq('store_id', store.id).eq('serie', Number(serie)).eq('numero', num).eq('status', 'autorizada').maybeSingle();
    if (!n?.xml_path) { console.log(num, 'sem nota autorizada com XML'); continue; }
    const { data: arq, error } = await admin.storage.from('fiscal-documentos').download(n.xml_path);
    if (error || !arq) { console.log(num, 'falha ao baixar XML', error?.message); continue; }
    const payload = payloadOmieDoNfeProc(await arq.text(), { codigoTaxa: taxa?.omie_codigo });
    const r = await enviarNfceAutorizadaAoOmie(admin, store.id, n.id, payload);
    console.log(num, payload.dEmi, payload.hEmi, 'R$', payload.vNF, '→', r?.status ?? 'sem integração', r?.erro ?? '');
    await new Promise((res) => setTimeout(res, 3000));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
