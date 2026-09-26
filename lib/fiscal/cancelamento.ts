import { SignedXml } from 'xml-crypto';

// Cancelamento de NF-e/NFC-e via evento 110111 ("Cancelamento"), versão 1.00
// do leiaute de eventos (NT 2011/006 + MOC 7.0). Isolado do pipeline de
// emissão de propósito: nada aqui é usado por app/api/fiscal/emitir.
//
// Endpoints do NFeRecepcaoEvento4 — mesma divisão da autorização (ver
// lib/fiscal/soap.ts e AGENTS.md): modelo 55 da BA vai pra infra PRÓPRIA da
// SEFAZ-BA; modelo 65 da BA é delegado pra SVRS. Fonte:
// nfephp-org/sped-nfe storage/wsnfe_4.00_mod55.xml (<BA>) e _mod65.xml (<SVRS>).
const ENDPOINTS_EVENTO: Record<'55' | '65', Record<'homologacao' | 'producao', string>> = {
  '55': {
    homologacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    producao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
  '65': {
    homologacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
    producao: 'https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  },
};

export function resolverEndpointEvento(modelo: '55' | '65', ambiente: 'homologacao' | 'producao'): string {
  return ENDPOINTS_EVENTO[modelo][ambiente];
}

export function ehUrlDeHomologacao(url: string): boolean {
  const host = new URL(url).hostname;
  return host.startsWith('hnfe.') || host.includes('homologacao');
}

export const JUSTIFICATIVA_MIN = 15;
export const JUSTIFICATIVA_MAX = 255;

// xJust: 15–255 caracteres, sem quebra de linha nem espaço nas pontas (o
// schema usa TString, que proíbe espaço inicial/final e whitespace repetido).
export function normalizarJustificativa(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Mesmo cuidado de lib/fiscal/xml.ts (componentesSaoPaulo): a hora vem do
// fuso de São Paulo, nunca do relógio cru do processo (que em servidor é UTC).
// Duplicado aqui (e não importado) pra não tocar no arquivo de emissão.
function agoraSaoPaulo(now: Date): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}-03:00`;
}

export interface EventoCancelamentoParams {
  chave: string; // 44 dígitos
  protocolo: string; // nProt da autorização
  justificativa: string; // já normalizada
  tpAmb: 1 | 2;
  agora?: Date;
}

// Monta o <evento> (sem assinatura). cOrgao = UF do emitente (2 primeiros
// dígitos da chave) — pra NFC-e da BA continua sendo 29 mesmo o evento indo
// pra SVRS. CNPJ = dígitos 7–20 da chave. nSeqEvento=1: cancelamento só
// acontece uma vez por nota.
export function montarEventoCancelamento(params: EventoCancelamentoParams): { xml: string; id: string } {
  const { chave, protocolo, justificativa, tpAmb } = params;
  if (!/^\d{44}$/.test(chave)) throw new Error('Chave de acesso inválida.');
  if (!/^\d{15}$/.test(protocolo)) throw new Error('Protocolo de autorização inválido.');
  if (justificativa.length < JUSTIFICATIVA_MIN || justificativa.length > JUSTIFICATIVA_MAX) {
    throw new Error(`Justificativa precisa ter entre ${JUSTIFICATIVA_MIN} e ${JUSTIFICATIVA_MAX} caracteres.`);
  }
  const cOrgao = chave.slice(0, 2);
  const cnpj = chave.slice(6, 20);
  const tpEvento = '110111';
  const nSeqEvento = 1;
  const id = `ID${tpEvento}${chave}${String(nSeqEvento).padStart(2, '0')}`;
  const dhEvento = agoraSaoPaulo(params.agora ?? new Date());

  const xml =
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<infEvento Id="${id}">` +
    `<cOrgao>${cOrgao}</cOrgao><tpAmb>${tpAmb}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chave}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento><tpEvento>${tpEvento}</tpEvento><nSeqEvento>${nSeqEvento}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${protocolo}</nProt>` +
    `<xJust>${escapeXml(justificativa)}</xJust></detEvento>` +
    `</infEvento></evento>`;
  return { xml, id };
}

// Mesmo algoritmo da assinatura da NF-e (lib/fiscal/assinatura.ts): enveloped
// + C14N + RSA-SHA1/SHA1, só que a referência é o <infEvento> e a Signature
// entra logo depois dele, dentro de <evento>.
export function assinarEvento(xml: string, id: string, certPem: string, keyPem: string): string {
  const sig = new SignedXml({ privateKey: keyPem, publicCert: certPem });
  sig.addReference({
    xpath: `//*[local-name(.)='infEvento']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    uri: `#${id}`,
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
  sig.computeSignature(xml, { location: { reference: `//*[local-name(.)='infEvento']`, action: 'after' } });
  return sig.getSignedXml();
}

export interface RespostaEvento {
  url: string;
  httpStatus: number;
  cStatLote: string | null; // 128 = "Lote de Evento Processado"
  cStat: string | null; // do <retEvento>: 135/155 = registrado
  xMotivo: string | null;
  protocolo: string | null;
  dhRegEvento: string | null;
  retEventoXml: string | null;
  xmlBruto: string;
}

// Mesmo princípio de parseRespostaSefaz: dois níveis de cStat. O do lote
// (128) na raiz não diz nada sobre o evento — o que vale é o de dentro de
// <retEvento><infEvento>. Sem <retEvento> (rejeição de lote/schema), cai pro
// cStat/xMotivo do lote, que é a única informação disponível.
export function parseRespostaEvento(xmlBruto: string, httpStatus: number, url: string): RespostaEvento {
  const cStatLote = xmlBruto.match(/<cStat>(\d+)<\/cStat>/)?.[1] ?? null;
  const retEventoXml = xmlBruto.match(/<retEvento[\s\S]*?<\/retEvento>/)?.[0] ?? null;
  if (retEventoXml) {
    return {
      url,
      httpStatus,
      cStatLote,
      cStat: retEventoXml.match(/<cStat>(\d+)<\/cStat>/)?.[1] ?? null,
      xMotivo: retEventoXml.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] ?? null,
      protocolo: retEventoXml.match(/<nProt>([^<]+)<\/nProt>/)?.[1] ?? null,
      dhRegEvento: retEventoXml.match(/<dhRegEvento>([^<]+)<\/dhRegEvento>/)?.[1] ?? null,
      retEventoXml,
      xmlBruto,
    };
  }
  return {
    url,
    httpStatus,
    cStatLote,
    cStat: cStatLote,
    xMotivo: xmlBruto.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] ?? null,
    protocolo: null,
    dhRegEvento: null,
    retEventoXml: null,
    xmlBruto,
  };
}

// Envelope SOAP 1.2 + mTLS, igual a transmitirNota (lib/fiscal/soap.ts), mas
// pro serviço NFeRecepcaoEvento4. `certPem` deve ser o certificado COM a
// cadeia da AC (certComCadeia), senão o IIS da SEFAZ devolve 403.
export async function transmitirEvento(params: {
  modelo: '55' | '65';
  ambiente: 'homologacao' | 'producao';
  eventoAssinado: string;
  certPem: string;
  keyPem: string;
}): Promise<RespostaEvento> {
  const { modelo, ambiente, eventoAssinado, certPem, keyPem } = params;
  const url = resolverEndpointEvento(modelo, ambiente);
  const tpAmbEvento = eventoAssinado.match(/<tpAmb>(\d)<\/tpAmb>/)?.[1];
  const tpAmbEsperado = ambiente === 'homologacao' ? '2' : '1';
  // Trava de coerência: o tpAmb que está DENTRO do evento assinado tem que
  // bater com o endpoint escolhido. Nunca manda um evento de produção pra
  // homologação (ou o contrário) por engano de parâmetro.
  if (tpAmbEvento !== tpAmbEsperado || ehUrlDeHomologacao(url) !== (ambiente === 'homologacao')) {
    throw new Error(`Incoerência de ambiente no cancelamento (tpAmb=${tpAmbEvento}, ambiente=${ambiente}).`);
  }
  console.log(`[fiscal/cancelar] enviando evento 110111 tpAmb=${tpAmbEvento} url=${url}`);

  const idLote = String(Date.now()).slice(-15);
  const envEvento =
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<idLote>${idLote}</idLote>${eventoAssinado}</envEvento>`;
  const soapBody =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${envEvento}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;

  const https = await import('node:https');
  const u = new URL(url);
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
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"',
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
      reject(new Error('Timeout na comunicação com a SEFAZ.'));
    });
    req.write(soapBody);
    req.end();
  });

  return parseRespostaEvento(xmlBruto, httpStatus, url);
}

// procEventoNFe = evento assinado + retEvento — é o XML que comprova o
// cancelamento (o equivalente do nfeProc pra eventos).
export function montarProcEvento(eventoAssinado: string, retEventoXml: string): string {
  const evento = eventoAssinado.replace(/^<\?xml[^>]*\?>/, '');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${evento}${retEventoXml}</procEventoNFe>`
  );
}

export function ehCancelamentoHomologado(cStat: string | null): boolean {
  // 135 = Evento registrado e vinculado a NF-e; 155 = Cancelamento homologado fora de prazo.
  return cStat === '135' || cStat === '155';
}

// Mensagem em português pro lojista. Sempre termina com o cStat/xMotivo cru
// entre parênteses, pra suporte conseguir pesquisar o código.
export function mensagemRejeicaoCancelamento(cStat: string | null, xMotivo: string | null): string {
  const cru = cStat ? ` (SEFAZ ${cStat}${xMotivo ? `: ${xMotivo}` : ''})` : '';
  switch (cStat) {
    case '501':
    case '220':
      return `O prazo legal para cancelar esta nota já passou. Para desfazer a venda, é preciso nota de devolução.${cru}`;
    case '573':
      return `Já existe um pedido de cancelamento registrado para esta nota na SEFAZ.${cru}`;
    case '218':
      return `Esta nota já está cancelada na SEFAZ.${cru}`;
    case '580':
    case '420':
      return `A SEFAZ não reconhece esta nota como autorizada (ela pode já ter sido cancelada ou denegada).${cru}`;
    case '222':
      return `O protocolo de autorização gravado não confere com o da SEFAZ.${cru}`;
    case '217':
      return `A SEFAZ não encontrou esta nota neste ambiente.${cru}`;
    case '108':
    case '109':
      return `A SEFAZ está fora do ar no momento. Tente de novo em alguns minutos.${cru}`;
    case null:
      return 'A SEFAZ não devolveu uma resposta válida. Tente de novo em alguns minutos.';
    default:
      return `A SEFAZ recusou o cancelamento.${cru}`;
  }
}

// Dados da autorização lidos do nfeProc gravado no Storage: ambiente real do
// documento (tpAmb de <ide>), protocolo e o instante da autorização
// (dhRecbto do protNFe) — é dele que o prazo legal é contado, não da hora em
// que a linha foi criada (em contingência a autorização vem bem depois).
export function extrairAutorizacaoDoNfeProc(nfeProc: string): {
  tpAmb: string | null;
  nProt: string | null;
  dhRecbto: string | null;
} {
  const ide = nfeProc.match(/<ide>[\s\S]*?<\/ide>/)?.[0] ?? '';
  const prot = nfeProc.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? '';
  return {
    tpAmb: ide.match(/<tpAmb>(\d)<\/tpAmb>/)?.[1] ?? null,
    nProt: prot.match(/<nProt>([^<]+)<\/nProt>/)?.[1] ?? null,
    dhRecbto: prot.match(/<dhRecbto>([^<]+)<\/dhRecbto>/)?.[1] ?? null,
  };
}
