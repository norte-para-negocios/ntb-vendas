// lib/omie/nota-fiscal.ts
import { omieRequest } from './client';
import type { ItemNota, PagamentoNota } from '@/lib/fiscal/xml';

export interface IncluirNfcePayload {
  chNFe: string;
  nNF: number;
  serie: number;
  dEmi: string;
  hEmi: string;
  tpAmb: 1 | 2;
  itens: { cProd: string; xProd: string; ncm: string; cfop: string; qCom: number; vUnCom: number }[];
  pagamentos: { tPag: string; vPag: number }[];
  nfceXml: string;
  nfceMd5: string;
  nfceProt: string;
  vNF: number;
}

// Mesma tabela de código de forma de pagamento já usada no XML da
// própria nota (lib/fiscal/xml.ts, mapMetodoParaTPag) — reaproveitada
// aqui só pra não duplicar o switch, sem importar a função privada.
function tPagDoMetodo(method: string): string {
  switch (method) {
    case 'CREDIT': return '03';
    case 'DEBIT': return '04';
    case 'PIX': return '17';
    case 'COURTESY': return '90';
    case 'CASH':
    default: return '01';
  }
}

// dEmi/hEmi precisam refletir o horário LOCAL (America/Sao_Paulo) da
// emissão, o mesmo que está gravado em <ide><dhEmi> no XML já assinado
// pela SEFAZ — toISOString() é sempre UTC (achado de review: perto da
// meia-noite local isso gera dEmi com a data ERRADA, e hEmi sempre 3h
// adiantado em relação ao horário real da nota).
function formatarDataHoraBR(data: Date): { dEmi: string; hEmi: string } {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(data);
  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const dEmi = `${get('year')}-${get('month')}-${get('day')}`;
  const hEmi = `${get('hour')}:${get('minute')}:${get('second')}`;
  return { dEmi, hEmi };
}

// Monta o payload a partir dos MESMOS dados já usados pra montar o XML
// da nota (ItemNota[]/PagamentoNota[], lib/fiscal/xml.ts) — nunca
// recalcula preço/imposto, só reformata pro shape que a Omie espera.
export function montarPayloadIncluirNfce(args: {
  chave: string;
  numero: number;
  serie: number;
  dataEmissao: Date;
  ambiente: 'homologacao' | 'producao';
  itens: ItemNota[];
  pagamentos: PagamentoNota[];
  nfeProcXml: string;
  nfceMd5: string;
  protocolo: string;
  valorTotal: number;
}): IncluirNfcePayload {
  const { dEmi, hEmi } = formatarDataHoraBR(args.dataEmissao);

  return {
    chNFe: args.chave,
    nNF: args.numero,
    serie: args.serie,
    dEmi,
    hEmi,
    tpAmb: args.ambiente === 'homologacao' ? 2 : 1,
    itens: args.itens.map((i) => ({
      cProd: i.cProd,
      xProd: i.xProd,
      ncm: i.ncm,
      cfop: i.cfop ?? '5102',
      qCom: i.qCom,
      vUnCom: i.vUnCom,
    })),
    pagamentos: args.pagamentos.map((p) => ({ tPag: tPagDoMetodo(p.method), vPag: p.amount })),
    nfceXml: args.nfeProcXml,
    nfceMd5: args.nfceMd5,
    nfceProt: args.protocolo,
    vNF: args.valorTotal,
  };
}

export async function incluirNfceDireto(
  credenciais: { appKey: string; appSecret: string },
  payload: IncluirNfcePayload
): Promise<{ status: string }> {
  const vProdTotal = payload.itens.reduce((acc, i) => acc + Number((i.qCom * i.vUnCom).toFixed(2)), 0);

  return omieRequest<{ status: string }>(
    'v1/produtos/cupomfiscalincluir',
    'IncluirNfce',
    {
      NFe: {
        chNFe: payload.chNFe,
        nNF: payload.nNF,
        serie: payload.serie,
        dEmi: payload.dEmi,
        hEmi: payload.hEmi,
        tpAmb: payload.tpAmb,
        tpEmis: 1,
        lCanc: 'N',
        det: payload.itens.map((item, idx) => ({
          seqItem: idx + 1,
          lCanc: 'N',
          lNaoMovEstoque: 'N',
          prodIdent: { cProd: item.cProd },
          prod: {
            cProd: item.cProd,
            xProd: item.xProd,
            NCM: item.ncm,
            CFOP: item.cfop,
            cUn: 'UN',
            nQuant: item.qCom,
            vUnit: item.vUnCom,
            vProd: Number((item.qCom * item.vUnCom).toFixed(2)),
            vDesc: 0,
            vAcresc: 0,
          },
        })),
        total: { vItem: vProdTotal, vProd: vProdTotal, vDesc: 0, vAcresc: 0, vICMS: 0, vCF: 0, vTaxa: 0, vTotTrib: 0 },
      },
      formasPag: payload.pagamentos.map((p, idx) => ({
        seqPag: idx + 1,
        pagIdent: { pag: p.tPag },
        pag: { tPag: p.tPag, vPag: p.vPag },
        lCanc: 'N',
        lNaoGerarTitulo: 'S',
      })),
      nfce: { nfceXml: payload.nfceXml, nfceMd5: payload.nfceMd5, nfceProt: payload.nfceProt },
    },
    credenciais
  );
}
