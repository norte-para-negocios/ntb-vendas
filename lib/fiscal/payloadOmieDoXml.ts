// Payload do envio ao Omie montado a partir do nfeProc AUTORIZADO (não do contexto da emissão). Usado para notas que
// não passaram pelo envio síncrono da rota de emissão: promovidas de contingência e as recuperadas do incidente de
// out/2026. Mesmo formato do caminho online: itens do cupom sem a taxa de serviço (o caminho online nunca a mandou
// como item; vNF continua com ela), pagamentos e data/hora do próprio <dhEmi>.
import { createHash } from 'node:crypto';
import type { IncluirNfcePayload } from '@/lib/omie/nota-fiscal';

const tag = (xml: string, nome: string) => xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`))?.[1] ?? null;

export function payloadOmieDoNfeProc(nfeProc: string, opts: { codigoTaxa?: string | null } = {}): IncluirNfcePayload {
  const chave = nfeProc.match(/Id="NFe(\d{44})"/)?.[1];
  const prot = nfeProc.match(/<protNFe[\s\S]*?<nProt>([^<]+)<\/nProt>/)?.[1];
  const dhEmi = tag(nfeProc, 'dhEmi');
  if (!chave || !prot || !dhEmi) throw new Error('nfeProc sem chave, protocolo ou dhEmi');
  const itens = [...nfeProc.matchAll(/<det nItem="\d+">[\s\S]*?<prod>([\s\S]*?)<\/prod>/g)]
    .map((m) => ({
      cProd: tag(m[1], 'cProd') ?? '',
      xProd: tag(m[1], 'xProd') ?? '',
      ncm: tag(m[1], 'NCM') ?? '',
      cfop: tag(m[1], 'CFOP') ?? '5102',
      qCom: Number(tag(m[1], 'qCom')),
      vUnCom: Number(tag(m[1], 'vUnCom')),
    }))
    .filter((i) => !opts.codigoTaxa || i.cProd !== opts.codigoTaxa);
  const pagamentos = [...nfeProc.matchAll(/<detPag>([\s\S]*?)<\/detPag>/g)].map((m) => ({
    tPag: tag(m[1], 'tPag') ?? '01',
    vPag: Number(tag(m[1], 'vPag')),
  }));
  return {
    chNFe: chave,
    nNF: Number(chave.slice(25, 34)),
    serie: Number(chave.slice(22, 25)),
    dEmi: dhEmi.slice(0, 10),
    hEmi: dhEmi.slice(11, 19),
    tpAmb: tag(nfeProc, 'tpAmb') === '2' ? 2 : 1,
    itens,
    pagamentos,
    nfceXml: nfeProc,
    nfceMd5: createHash('md5').update(nfeProc).digest('hex'),
    nfceProt: prot,
    vNF: Number(nfeProc.match(/<ICMSTot>[\s\S]*?<vNF>([^<]+)<\/vNF>/)?.[1]),
  };
}
