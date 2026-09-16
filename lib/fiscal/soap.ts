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

export interface EndpointsNfceConsulta {
  urlQrCode: string;
  urlChave: string;
}

// URLs que vão DENTRO do XML da NFC-e (infNFeSupl: qrCode/urlChave) — a
// SEFAZ não valida essas strings no envio (só o hash embutido no próprio
// qrCode, calculado com o CSC — ver lib/fiscal/qrcode.ts), mas o cupom
// impresso tem que apontar pro host do ambiente certo, senão o cliente
// final tenta consultar a nota no host errado. Bug real corrigido em
// 2026-08-05: antes ficava hardcoded sempre em homologação
// (hnfe/hinternet), então uma nota emitida em produção teria QR Code
// funcional (a SEFAZ processa a nota normalmente) mas print apontando pro
// ambiente de teste.
// - urlQrCode: confirmado nos dois ambientes (homologação testada ao vivo
//   em 2026-08-04, ver AGENTS.md; produção confirmada via
//   nfephp-org/sped-nfe storage/wsnfe_4.00_mod65.xml + documentação
//   pública da SEFAZ-BA — mesmo padrão hnfe.*->nfe.* já confirmado no
//   endpoint de autorização acima).
// - urlChave: homologação testada ao vivo; produção não foi exercitada
//   (é só texto informativo, nunca chamada por código nosso), valor
//   tirado de fontes públicas de integração fiscal (TecnoSpeed/invoiSys),
//   mesmo padrão de troca de host.
const ENDPOINTS_NFCE_CONSULTA: Record<'homologacao' | 'producao', EndpointsNfceConsulta> = {
  homologacao: {
    urlQrCode: 'http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx',
    urlChave: 'http://hinternet.sefaz.ba.gov.br/nfce/consulta',
  },
  producao: {
    urlQrCode: 'http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx',
    urlChave: 'http://www.sefaz.ba.gov.br/nfce/consulta',
  },
};

export function resolverEndpointsNfceConsulta(ambiente: 'homologacao' | 'producao'): EndpointsNfceConsulta {
  return ENDPOINTS_NFCE_CONSULTA[ambiente];
}

export interface RespostaSefaz {
  httpStatus: number;
  // Status da NOTA (não do lote) — vem de dentro de <protNFe><infProt>
  // quando existe; só cai pro nível de lote se a SEFAZ rejeitou antes de
  // gerar protocolo (ver comentário no parsing abaixo pro porquê).
  cStat: string | null;
  xMotivo: string | null;
  // Status do LOTE (<retEnviNFe><cStat>), sempre '104' "Lote processado"
  // num envio síncrono (indSinc=1) bem-sucedido — NÃO significa nota
  // autorizada, só que a SEFAZ recebeu e processou o lote. Exposto à parte
  // só pra diagnóstico (distinguir "lote nem chegou a ser processado" de
  // "processado mas sem protNFe"); nunca usar isso como critério de
  // autorização — use `cStat` acima.
  cStatLote: string | null;
  protocolo: string | null;
  xmlBruto: string;
}

// Parsing isolado numa função pura (sem I/O) de propósito: permite testar a
// lógica de extração de cStat/xMotivo/protocolo com um corpo XML fake, sem
// precisar de certificado real nem de conexão com a SEFAZ — não existe
// framework de teste automatizado neste projeto (decisão intencional, ver
// AGENTS.md), então isso é o que torna essa lógica verificável de verdade
// em vez de só "parece certo".
//
// BUG CRÍTICO corrigido em 2026-08-05: em modo síncrono (indSinc=1), o
// retEnviNFe tem DOIS níveis de cStat — o do LOTE (sempre 104 "Lote
// processado" quando a SEFAZ recebeu, não é autorização) na raiz, e o da
// NOTA (o 100 "Autorizado o uso da NF-e" real, ou a rejeição de negócio de
// verdade) dentro de <protNFe><infProt>. Um match ingênuo no primeiro
// <cStat> do corpo pega SEMPRE o do lote (104), nunca o da nota — isso
// fazia toda emissão bem-sucedida ser classificada como rejeitada em
// app/api/fiscal/emitir/route.ts (`cStat=104 Lote processado`), Fase 2
// (PDF/Storage) nunca rodava, e o protocolo real era descartado. Mesmo
// approach do script de referência já validado contra a SEFAZ real
// (scripts/nfce-referencia/gerar-nfce-teste.mjs:195): extrai o subtree de
// <protNFe> PRIMEIRO, e só lê cStat/xMotivo de DENTRO dele.
export function parseRespostaSefaz(xmlBruto: string, httpStatus: number): RespostaSefaz {
  const cStatLote = xmlBruto.match(/<cStat>(\d+)<\/cStat>/)?.[1] ?? null;
  const protNFe = xmlBruto.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? null;

  let cStat: string | null;
  let xMotivo: string | null;
  let protocolo: string | null;

  if (protNFe) {
    // Caminho normal de sucesso (e também de algumas rejeições que a SEFAZ
    // processa a ponto de gerar protocolo, ex. denegada) — cStat/xMotivo
    // da NOTA, não do lote.
    cStat = protNFe.match(/<cStat>(\d+)<\/cStat>/)?.[1] ?? null;
    xMotivo = protNFe.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] ?? null;
    protocolo = protNFe.match(/<nProt>([^<]+)<\/nProt>/)?.[1] ?? null;
  } else {
    // Rejeição de lote/validação (ex.: cStat=702/225/486/495, documentados
    // em AGENTS.md) nunca produz <protNFe> — não existe "status da nota"
    // nesse caso, só o do lote mesmo, que é a informação real disponível.
    cStat = cStatLote;
    xMotivo = xmlBruto.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] ?? null;
    protocolo = null;
  }

  return { httpStatus, cStat, xMotivo, cStatLote, protocolo, xmlBruto };
}

// Códigos de status em que a SEFAZ NÃO analisou o documento — ela está fora
// do ar, paralisada ou sobrecarregada. São códigos de LOTE (chegam aqui pelo
// ramo `else` de parseRespostaSefaz, quando não existe <protNFe>: sem
// protocolo não há "status da nota", só o do lote), e NÃO são rejeições de
// negócio: reenviar o MESMO documento depois pode perfeitamente autorizar.
// Tratá-los como rejeição terminal ('rejeitada') é exatamente o modo de
// falha que a contingência offline existe pra evitar — a venda ficaria sem
// nenhum caminho válido pra virar documento fiscal.
//
//   105 Lote em processamento              (SEFAZ não processou sincronicamente)
//   106 Lote não localizado
//   108 Serviço Paralisado Momentaneamente
//   109 Serviço Paralisado sem Previsão
//
// `null` entra na mesma classe: resposta sem cStat reconhecível (página de
// erro HTML de gateway, corpo vazio, conexão cortada no meio do body) é
// falha de transporte disfarçada de resposta HTTP — a SEFAZ nunca viu o
// documento.
//
// Deliberadamente FORA da lista (verificado lendo parseRespostaSefaz):
// - '104' (Lote processado) nunca chega como `cStat` num fluxo normal — com
//   <protNFe> o cStat lido é o da nota; sem <protNFe> um 104 seria uma
//   resposta malformada, não um sinal de indisponibilidade.
// - '103' (Lote recebido com sucesso) é do fluxo ASSÍNCRONO (indSinc=0), que
//   este código nunca usa (transmitirNota manda indSinc=1). Se aparecesse,
//   significaria que a SEFAZ vai processar o lote DEPOIS — cair pra
//   contingência aí arriscaria um segundo documento pra mesma venda, então
//   fica de fora de propósito.
export function ehSefazIndisponivel(cStat: string | null): boolean {
  return cStat === null || cStat === '105' || cStat === '106' || cStat === '108' || cStat === '109';
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

  return parseRespostaSefaz(xmlBruto, httpStatus);
}
