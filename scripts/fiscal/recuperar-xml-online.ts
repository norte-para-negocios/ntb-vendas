// rodar com: npx tsx --env-file=.env.local scripts/fiscal/recuperar-xml-online.ts [--gravar]
// Incidente Sertão out/2026: a tentativa online deu timeout mas foi AUTORIZADA; a contingência (mesmo número, outra
// chave) voltou 539 e a nota ficou 'rejeitada'. O XML autorizado não foi guardado, mas ele é o XML da contingência com
// cNF/tpEmis/cDV da chave online, sem dhCont/xJust e com o dhEmi alguns segundos antes. Testa cada segundo até o
// DigestValue bater com o digVal do protocolo da SEFAZ (prova de que é o documento autorizado, byte a byte).
// Sem --gravar: só reconstrói, confere e salva os nfeProc em scratch. Com --gravar: sobe XML/PDF e marca 'autorizada'.
import { writeFileSync, mkdirSync } from 'node:fs';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { carregarCredenciaisFiscaisDaLoja } from '../../lib/fiscal/carregarCredenciaisFiscaisDaLoja';
import { consultarSituacaoChave, chaveDaDuplicidade, resolverEndpointsNfceConsulta } from '../../lib/fiscal/soap';
import { assinarXmlNota } from '../../lib/fiscal/assinatura';
import { montarQrCode, inserirSuplNoXmlAssinado } from '../../lib/fiscal/qrcode';
import { montarNfeProc } from '../../lib/fiscal/pdf';
import { salvarNotaAutorizada } from '../../lib/fiscal/salvarNotaAutorizada';

const GRAVAR = process.argv.includes('--gravar');
const SAIDA = process.env.SAIDA_RECUPERACAO || '/tmp/recuperacao-nfce';

function infNFeSemAssinatura(xmlCont: string): string {
  const m = xmlCont.match(/<NFe xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe">(<infNFe[\s\S]*?<\/infNFe>)/);
  if (!m) throw new Error('infNFe não encontrado no XML de contingência');
  return m[1];
}

function deslocar(dhEmi: string, seg: number): string {
  // dhEmi no formato AAAA-MM-DDTHH:MM:SS-03:00
  const t = new Date(dhEmi).getTime() - seg * 1000;
  const d = new Date(t - 3 * 3600 * 1000); // horário de Brasília em UTC "falso"
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}-03:00`;
}

async function main() {
  mkdirSync(SAIDA, { recursive: true });
  const admin = getSupabaseAdmin();
  const { data: notas, error } = await admin
    .from('fiscal_notas')
    .select('id, store_id, order_id, table_id, modelo, ambiente, numero, serie, motivo_erro, xml_contingencia')
    .eq('status', 'rejeitada').like('motivo_erro', 'cStat=539%').order('numero');
  if (error) throw error;
  let ok = 0;
  for (const n of notas ?? []) {
    const chaveOn = chaveDaDuplicidade(n.motivo_erro);
    if (!chaveOn || !n.xml_contingencia) { console.log(n.numero, 'sem chave/xml'); continue; }
    if (Number(chaveOn.slice(22, 25)) !== n.serie || Number(chaveOn.slice(25, 34)) !== n.numero) { console.log(n.numero, 'num/série não batem'); continue; }
    const cred = await carregarCredenciaisFiscaisDaLoja(admin, n.store_id);
    const sit = await consultarSituacaoChave({ modelo: n.modelo, ambiente: n.ambiente, chave: chaveOn, certPem: cred.certComCadeia, keyPem: cred.keyPem });
    if (sit.situacao !== 'autorizada') { console.log(n.numero, 'SEFAZ:', sit.situacao, sit.cStat); continue; }
    const digVal = sit.protNFe?.match(/<digVal>([^<]+)<\/digVal>/)?.[1];
    const dhRecbto = sit.protNFe?.match(/<dhRecbto>([^<]+)<\/dhRecbto>/)?.[1];

    let inf = infNFeSemAssinatura(n.xml_contingencia);
    const dhCont = inf.match(/<dhEmi>([^<]+)<\/dhEmi>/)![1];
    inf = inf
      .replace(/Id="NFe\d{44}"/, `Id="NFe${chaveOn}"`)
      .replace(/<cNF>\d{8}<\/cNF>/, `<cNF>${chaveOn.slice(35, 43)}</cNF>`)
      .replace(/<tpEmis>9<\/tpEmis>/, '<tpEmis>1</tpEmis>')
      .replace(/<cDV>\d<\/cDV>/, `<cDV>${chaveOn.slice(43)}</cDV>`)
      .replace(/<dhCont>[^<]*<\/dhCont><xJust>[^<]*<\/xJust>/, '');

    let achado: string | null = null;
    let segAchado = -1;
    for (let s = 0; s <= 900 && !achado; s++) {
      const cand = inf.replace(/<dhEmi>[^<]+<\/dhEmi>/, `<dhEmi>${deslocar(dhCont, s)}</dhEmi>`);
      const xml = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${cand}</NFe>`;
      const assinado = assinarXmlNota(xml, `NFe${chaveOn}`, cred.certPem, cred.keyPem);
      if (assinado.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1] === digVal) { achado = assinado; segAchado = s; }
    }
    if (!achado) { console.log(n.numero, 'NÃO ACHEI o dhEmi (digVal', digVal, ')'); continue; }

    // QR online (mesma receita do passo 9 da rota de emissão).
    const { data: sec } = await admin.from('store_fiscal_config_secrets').select('csc_producao, cscid_producao, csc_homologacao, cscid_homologacao').eq('store_id', n.store_id).maybeSingle();
    const prod = n.ambiente === 'producao';
    const { urlQrCode, urlChave } = resolverEndpointsNfceConsulta(n.ambiente);
    const { supl } = montarQrCode({ chave: chaveOn, tpAmb: prod ? 1 : 2, idCsc: (prod ? sec?.cscid_producao : sec?.cscid_homologacao)!, csc: (prod ? sec?.csc_producao : sec?.csc_homologacao)!, urlQrCode, urlChave });
    const xmlFinal = inserirSuplNoXmlAssinado(achado, supl);
    writeFileSync(`${SAIDA}/${chaveOn}-nfeProc.xml`, montarNfeProc(xmlFinal, sit.protNFe!));
    ok++;
    console.log(`${n.numero} | digest OK | dhEmi ${deslocar(dhCont, segAchado)} (${segAchado}s antes da contingência) | recebido SEFAZ ${dhRecbto} | protocolo ${sit.protocolo}`);

    if (GRAVAR) {
      const { data: itensDaNota } = await admin.from('order_items').select('id, fiscal_nota_id').eq('order_id', n.order_id!).neq('status', 'canceled');
      const livres = (itensDaNota ?? []).filter((i) => !i.fiscal_nota_id || i.fiscal_nota_id === n.id);
      const r = await salvarNotaAutorizada({
        storeId: n.store_id, modelo: n.modelo, chave: chaveOn, numero: n.numero!, serie: n.serie!,
        xmlAssinado: xmlFinal, protocoloXmlBruto: sit.xmlBruto, protocolo: sit.protocolo, valorTotalComTaxa: 0,
        notaBase: { store_id: n.store_id, order_id: n.order_id, table_id: n.table_id, modelo: n.modelo, ambiente: n.ambiente },
        itensValidos: livres.map((i) => ({ id: i.id })), notaIdExistente: n.id,
      });
      await admin.from('fiscal_notas').update({
        motivo_erro: `Recuperada 23/10: autorizada pela tentativa online (timeout), contingência voltou 539. XML reconstruído e conferido pelo digVal do protocolo.${r.motivoPosAutorizacao ? ' ' + r.motivoPosAutorizacao : ''}`,
        omie_status: null,
      }).eq('id', n.id);
      console.log('   gravada', r.notaId, `itens ${livres.length}/${itensDaNota?.length ?? 0}`);
    }
  }
  console.log(`recuperadas ${ok}/${notas?.length ?? 0}${GRAVAR ? ' (gravadas)' : ' (só conferência)'}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
