// Inutilização de numeração NFC-e/NF-e na SEFAZ (NFeInutilizacao4). Número que nunca virou documento autorizado
// (rejeição de schema, por exemplo) deixa lacuna na série; a inutilização é obrigação fiscal (incidente Sertão out/2026:
// 74 e 75 da série 002, rejeitados por NCM em 03/10).
import { SignedXml } from 'xml-crypto';

const ENDPOINTS: Record<'55' | '65', Record<'homologacao' | 'producao', string>> = {
  '55': {
    homologacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx',
    producao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx',
  },
  '65': {
    homologacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
    producao: 'https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  },
};

export interface PedidoInutilizacao {
  modelo: '55' | '65';
  ambiente: 'homologacao' | 'producao';
  cUF: string; // '29' = BA
  ano: number; // 2 dígitos (ano da emissão)
  cnpj: string;
  serie: number;
  inicio: number;
  fim: number;
  justificativa: string; // 15 a 255 caracteres
}

const pad = (n: number | string, t: number) => String(n).padStart(t, '0');

export function montarInutilizacao(p: PedidoInutilizacao): { xml: string; id: string } {
  const cnpj = p.cnpj.replace(/\D/g, '');
  const just = p.justificativa.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[<>&"']/g, '').trim();
  if (just.length < 15 || just.length > 255) throw new Error('Justificativa precisa de 15 a 255 caracteres.');
  if (p.inicio < 1 || p.fim < p.inicio) throw new Error('Faixa de numeração inválida.');
  const id = `ID${p.cUF}${pad(p.ano, 2)}${cnpj}${p.modelo}${pad(p.serie, 3)}${pad(p.inicio, 9)}${pad(p.fim, 9)}`;
  const xml =
    `<inutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infInut Id="${id}">` +
    `<tpAmb>${p.ambiente === 'producao' ? 1 : 2}</tpAmb><xServ>INUTILIZAR</xServ><cUF>${p.cUF}</cUF><ano>${pad(p.ano, 2)}</ano>` +
    `<CNPJ>${cnpj}</CNPJ><mod>${p.modelo}</mod><serie>${p.serie}</serie><nNFIni>${p.inicio}</nNFIni><nNFFin>${p.fim}</nNFFin>` +
    `<xJust>${just}</xJust></infInut></inutNFe>`;
  return { xml, id };
}

export function assinarInutilizacao(xml: string, id: string, certPem: string, keyPem: string): string {
  const sig = new SignedXml({ privateKey: keyPem, publicCert: certPem });
  sig.addReference({
    xpath: `//*[local-name(.)='infInut']`,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    uri: `#${id}`,
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
  sig.computeSignature(xml, { location: { reference: `//*[local-name(.)='infInut']`, action: 'after' } });
  return sig.getSignedXml();
}

export interface RespostaInutilizacao {
  homologada: boolean; // cStat 102
  cStat: string | null;
  xMotivo: string | null;
  protocolo: string | null;
  xmlBruto: string;
}

export function parseRespostaInutilizacao(xmlBruto: string): RespostaInutilizacao {
  const inf = xmlBruto.match(/<infInut[\s\S]*?<\/infInut>/)?.[0] ?? xmlBruto;
  const cStat = inf.match(/<cStat>(\d+)<\/cStat>/)?.[1] ?? null;
  return {
    homologada: cStat === '102',
    cStat,
    xMotivo: inf.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] ?? null,
    protocolo: inf.match(/<nProt>([^<]+)<\/nProt>/)?.[1] ?? null,
    xmlBruto,
  };
}

export async function inutilizarNumeracao(p: PedidoInutilizacao & { certComCadeia: string; certPem: string; keyPem: string }): Promise<RespostaInutilizacao> {
  const { xml, id } = montarInutilizacao(p);
  const assinado = assinarInutilizacao(xml, id, p.certPem, p.keyPem);
  const soapBody =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4">${assinado}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
  const https = await import('node:https');
  const u = new URL(ENDPOINTS[p.modelo][p.ambiente]);
  const xmlBruto = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname, path: u.pathname, method: 'POST', cert: p.certComCadeia, key: p.keyPem, rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4/nfeInutilizacaoNF"',
          'Content-Length': Buffer.byteLength(soapBody),
        },
        timeout: 60000,
      },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d)); },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout na inutilização.')); });
    req.write(soapBody);
    req.end();
  });
  return parseRespostaInutilizacao(xmlBruto);
}
