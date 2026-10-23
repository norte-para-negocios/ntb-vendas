// rodar com: npx tsx --env-file=.env.local scripts/fiscal/inutilizar.ts <loja-like> <homologacao|producao> <serie> <inicio> <fim> "<justificativa>"
// Antes de inutilizar, confere que nenhum número da faixa tem nota autorizada/cancelada no nosso banco e, para os que
// têm chave gravada, consulta a SEFAZ (precisa voltar "não consta"). Grava o protocolo no log da execução.
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { carregarCredenciaisFiscaisDaLoja } from '../../lib/fiscal/carregarCredenciaisFiscaisDaLoja';
import { consultarSituacaoChave } from '../../lib/fiscal/soap';
import { inutilizarNumeracao } from '../../lib/fiscal/inutilizacao';

async function main() {
  const [loja, amb, serieS, iniS, fimS, just] = process.argv.slice(2);
  const ambiente = amb as 'homologacao' | 'producao';
  const serie = Number(serieS), inicio = Number(iniS), fim = Number(fimS);
  const admin = getSupabaseAdmin();
  const { data: store } = await admin.from('stores').select('id, name, cnpj').ilike('name', `%${loja}%`).single();
  if (!store) throw new Error('loja não encontrada');
  const cred = await carregarCredenciaisFiscaisDaLoja(admin, store.id);
  const { data: notas } = await admin.from('fiscal_notas').select('numero, status, chave_acesso')
    .eq('store_id', store.id).eq('serie', serie).eq('ambiente', ambiente).eq('modelo', '65').gte('numero', inicio).lte('numero', fim);
  for (const n of notas ?? []) {
    if (['autorizada', 'cancelada', 'contingencia'].includes(n.status)) throw new Error(`número ${n.numero} está ${n.status}: não inutilizar`);
    if (n.chave_acesso) {
      const s = await consultarSituacaoChave({ modelo: '65', ambiente, chave: n.chave_acesso, certPem: cred.certComCadeia, keyPem: cred.keyPem });
      console.log(`consulta ${n.numero}: ${s.situacao} ${s.cStat} ${s.xMotivo ?? ''}`);
      if (s.situacao !== 'nao_existe') throw new Error(`número ${n.numero} não está livre na SEFAZ`);
    }
  }
  const r = await inutilizarNumeracao({
    modelo: '65', ambiente, cUF: '29', ano: new Date().getFullYear() % 100, cnpj: store.cnpj, serie, inicio, fim, justificativa: just,
    certComCadeia: cred.certComCadeia, certPem: cred.certPem, keyPem: cred.keyPem,
  });
  console.log(`${store.name} ${ambiente} série ${serie} ${inicio}-${fim}: cStat=${r.cStat} ${r.xMotivo} protocolo=${r.protocolo ?? '-'}`);
  if (!r.homologada) console.log(r.xmlBruto.slice(0, 1500));
}
main().catch((e) => { console.error(e); process.exit(1); });
