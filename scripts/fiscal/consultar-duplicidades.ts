// rodar com: npx tsx --env-file=.env.local scripts/fiscal/consultar-duplicidades.ts
// SÓ LEITURA. Para cada nota 'rejeitada' com cStat=539, consulta na SEFAZ a chave citada na rejeição (a que ficou
// autorizada no lugar da nossa) e imprime situação, protocolo e se número/série batem. Não grava nada.
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { carregarCredenciaisFiscaisDaLoja } from '../../lib/fiscal/carregarCredenciaisFiscaisDaLoja';
import { consultarSituacaoChave, chaveDaDuplicidade } from '../../lib/fiscal/soap';

async function main() {
  const admin = getSupabaseAdmin();
  const { data: notas, error } = await admin
    .from('fiscal_notas')
    .select('id, store_id, modelo, ambiente, numero, serie, valor_total, motivo_erro, created_at')
    .eq('status', 'rejeitada').like('motivo_erro', 'cStat=539%').order('numero');
  if (error) throw error;
  const creds = new Map<string, Awaited<ReturnType<typeof carregarCredenciaisFiscaisDaLoja>>>();
  for (const n of notas ?? []) {
    const chave = chaveDaDuplicidade(n.motivo_erro);
    if (!chave) { console.log(n.numero, 'sem chave na mensagem'); continue; }
    if (!creds.has(n.store_id)) creds.set(n.store_id, await carregarCredenciaisFiscaisDaLoja(admin, n.store_id));
    const c = creds.get(n.store_id)!;
    const r = await consultarSituacaoChave({ modelo: n.modelo, ambiente: n.ambiente, chave, certPem: c.certComCadeia, keyPem: c.keyPem });
    const bate = Number(chave.slice(22, 25)) === n.serie && Number(chave.slice(25, 34)) === n.numero;
    console.log([n.numero, n.serie, n.valor_total, chave, 'tpEmis=' + chave[34], r.situacao, r.cStat, r.protocolo ?? '-', bate ? 'num/serie ok' : 'NUM/SERIE DIFERENTE', (r.xMotivo ?? '').slice(0, 60)].join(' | '));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
