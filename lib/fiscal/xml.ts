import { montarChaveAcesso } from './chaveAcesso';

export interface ItemNota {
  cProd: string; // código do produto (pode ser o id truncado ou omie_codigo)
  xProd: string; // descrição
  ncm: string;
  qCom: number;
  vUnCom: number;
  cfop?: string; // default 5102
}

export interface DestinatarioNota {
  cpfCnpj: string;
  nome: string;
}

export interface DadosEmitenteNota {
  cnpj: string;
  ie: string;
  razaoSocial: string;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  cMun: string; // código IBGE
  uf: string;
  cep: string;
  cUF: number; // código IBGE da UF (29 = BA)
  cstCsosnPadrao: string;
  cstPisPadrao: string;
  cstCofinsPadrao: string;
  autXmlCnpj?: string; // exigência específica da BA — CNPJ do escritório de contabilidade
}

export interface MontarXmlParams {
  modelo: '55' | '65';
  ambiente: 'homologacao' | 'producao';
  serie: number;
  numero: number;
  emitente: DadosEmitenteNota;
  itens: ItemNota[];
  destinatario?: DestinatarioNota; // obrigatório pra modelo 55, ausente pra 65
}

const pad = (n: number | string, len: number) => String(n).padStart(len, '0');

// Texto obrigatório em homologação (SEFAZ rejeita sem isso). Pra NFC-e (sem
// <dest>), vai no xProd do primeiro item; pra NF-e, no xNome do <dest> — ver
// histórico em AGENTS.md (2026-08-04) sobre qual campo é o certo pra cada modelo.
const AVISO_HOMOLOGACAO = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export function montarXmlNota(params: MontarXmlParams): { xml: string; chave: string; infNFeId: string } {
  const { modelo, ambiente, serie, numero, emitente, itens, destinatario } = params;
  if (!itens.length) throw new Error('Nota sem itens.');
  if (modelo === '55' && !destinatario) throw new Error('NF-e (modelo 55) exige destinatário.');

  const tpAmb = ambiente === 'homologacao' ? 2 : 1;
  const now = new Date();
  const anoMes = pad(now.getFullYear() % 100, 2) + pad(now.getMonth() + 1, 2);

  const { chave, cNF } = montarChaveAcesso({
    cUF: emitente.cUF,
    anoMes,
    cnpj: emitente.cnpj,
    modelo,
    serie,
    numero,
  });

  const dhEmi =
    `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}` +
    `T${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}:${pad(now.getSeconds(), 2)}-03:00`;

  const infNFeId = `NFe${chave}`;

  let vProdTotal = 0;
  const detXml = itens
    .map((item, i) => {
      const vProd = Number((item.qCom * item.vUnCom).toFixed(2));
      vProdTotal += vProd;
      const xProd =
        tpAmb === 2 && i === 0 && modelo === '65' ? `${item.xProd} - ${AVISO_HOMOLOGACAO}` : item.xProd;
      return (
        `<det nItem="${i + 1}"><prod><cProd>${item.cProd}</cProd><cEAN>SEM GTIN</cEAN><xProd>${xProd}</xProd>` +
        `<NCM>${item.ncm}</NCM><CFOP>${item.cfop ?? '5102'}</CFOP><uCom>UN</uCom>` +
        `<qCom>${item.qCom.toFixed(4)}</qCom><vUnCom>${item.vUnCom.toFixed(10)}</vUnCom>` +
        `<vProd>${vProd.toFixed(2)}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib>` +
        `<qTrib>${item.qCom.toFixed(4)}</qTrib><vUnTrib>${item.vUnCom.toFixed(10)}</vUnTrib><indTot>1</indTot></prod>` +
        `<imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>${emitente.cstCsosnPadrao}</CSOSN></ICMSSN102></ICMS>` +
        `<PIS><PISNT><CST>${emitente.cstPisPadrao}</CST></PISNT></PIS>` +
        `<COFINS><COFINSNT><CST>${emitente.cstCofinsPadrao}</CST></COFINSNT></COFINS></imposto></det>`
      );
    })
    .join('');

  const destXml = destinatario
    ? (() => {
        const doc = destinatario.cpfCnpj.replace(/\D/g, '');
        const tagDoc = doc.length === 14 ? 'CNPJ' : 'CPF';
        const xNome = tpAmb === 2 ? `${destinatario.nome} - ${AVISO_HOMOLOGACAO}` : destinatario.nome;
        return `<dest><${tagDoc}>${doc}</${tagDoc}><xNome>${xNome}</xNome><indIEDest>9</indIEDest></dest>`;
      })()
    : '';

  // autXML antes de det (ordem do schema — ver AGENTS.md, "autXML depois de
  // pag dá cStat=225 Falha no Schema XML"). Só entra se a loja configurou um
  // CNPJ de escritório de contabilidade; senão a BA aceita sem esse grupo
  // pra quem não é obrigado (confirmar caso a caso — ver cStat=486 no histórico).
  const autXmlXml = emitente.autXmlCnpj ? `<autXML><CNPJ>${emitente.autXmlCnpj}</CNPJ></autXML>` : '';

  const vNF = vProdTotal.toFixed(2);

  const nfeXml =
    `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="${infNFeId}" versao="4.00">` +
    `<ide><cUF>${emitente.cUF}</cUF><cNF>${cNF}</cNF><natOp>VENDA AO CONSUMIDOR</natOp><mod>${modelo}</mod>` +
    `<serie>${serie}</serie><nNF>${numero}</nNF><dhEmi>${dhEmi}</dhEmi><tpNF>1</tpNF>` +
    `<idDest>${destinatario ? 1 : 1}</idDest><cMunFG>${emitente.cMun}</cMunFG>` +
    `<tpImp>${modelo === '65' ? 4 : 1}</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV>` +
    `<tpAmb>${tpAmb}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres>` +
    `<procEmi>0</procEmi><verProc>ntb-vendas-1.0</verProc></ide>` +
    `<emit><CNPJ>${emitente.cnpj}</CNPJ><xNome>${emitente.razaoSocial}</xNome>` +
    `<enderEmit><xLgr>${emitente.logradouro}</xLgr><nro>${emitente.numero}</nro><xBairro>${emitente.bairro}</xBairro>` +
    `<cMun>${emitente.cMun}</cMun><xMun>${emitente.municipio}</xMun><UF>${emitente.uf}</UF><CEP>${emitente.cep}</CEP>` +
    `<cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit><IE>${emitente.ie}</IE><CRT>1</CRT></emit>` +
    destXml +
    autXmlXml +
    detXml +
    `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP>` +
    `<vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${vNF}</vProd>` +
    `<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI>` +
    `<vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro>` +
    `<vNF>${vNF}</vNF></ICMSTot></total><transp><modFrete>9</modFrete></transp>` +
    `<pag><detPag><indPag>0</indPag><tPag>01</tPag><vPag>${vNF}</vPag></detPag></pag>` +
    `</infNFe></NFe>`;

  return { xml: nfeXml, chave, infNFeId };
}
