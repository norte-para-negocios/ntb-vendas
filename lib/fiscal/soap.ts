export interface EndpointsSefaz {
  autorizacao: string;
}

// Endpoints da Bahia — modelo 55 na infraestrutura própria da BA, modelo 65
// delegado pra SEFAZ Virtual do RS (SVRS). Confirmado por teste real em
// 2026-08-04 (ver AGENTS.md) depois de 3 tentativas erradas mandando modelo
// 65 pro endpoint de modelo 55. Isolado aqui pra facilitar adicionar outras
// UFs depois sem mexer no resto do pipeline — hoje só BA está implementado.
const ENDPOINTS: Record<'55' | '65', Record<'homologacao' | 'producao', EndpointsSefaz>> = {
  '55': {
    homologacao: { autorizacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx' },
    producao: { autorizacao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx' },
  },
  '65': {
    homologacao: { autorizacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx' },
    producao: { autorizacao: 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx' },
  },
};

export function resolverEndpoint(modelo: '55' | '65', ambiente: 'homologacao' | 'producao'): EndpointsSefaz {
  return ENDPOINTS[modelo][ambiente];
}

export interface RespostaSefaz {
  httpStatus: number;
  cStat: string | null;
  xMotivo: string | null;
  protocolo: string | null;
  xmlBruto: string;
}

// Envelope SOAP 1.2 + envio via mTLS (cert+key do certificado da loja,
// rejectUnauthorized:false porque o bundle de CA do Node não traz a cadeia
// ICP-Brasil — mesmo ajuste já validado no script de referência).
export async function transmitirNota(params: {
  modelo: '55' | '65';
  ambiente: 'homologacao' | 'producao';
  xmlAssinadoComSupl: string;
  certPem: string;
  keyPem: string;
}): Promise<RespostaSefaz> {
  const { modelo, ambiente, xmlAssinadoComSupl, certPem, keyPem } = params;
  const endpoint = resolverEndpoint(modelo, ambiente);

  const enviNFe =
    `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<idLote>1</idLote><indSinc>1</indSinc>${xmlAssinadoComSupl}</enviNFe>`;

  const soapBody =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${enviNFe}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;

  const https = await import('node:https');
  const u = new URL(endpoint.autorizacao);

  let httpStatus = 0;

  const xmlBruto = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        cert: certPem,
        key: keyPem,
        rejectUnauthorized: false,
        headers: {
          'Content-Type':
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
          'Content-Length': Buffer.byteLength(soapBody),
        },
        timeout: 30000,
      },
      (res) => {
        httpStatus = res.statusCode ?? 0;
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na transmissão pra SEFAZ.'));
    });
    req.write(soapBody);
    req.end();
  });

  const cStat = xmlBruto.match(/<cStat>(\d+)<\/cStat>/)?.[1] ?? null;
  const xMotivo = xmlBruto.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] ?? null;
  const protocolo = xmlBruto.match(/<nProt>([^<]+)<\/nProt>/)?.[1] ?? null;

  return { httpStatus, cStat, xMotivo, protocolo, xmlBruto };
}
