// REFERENCIA de um teste manual bem-sucedido feito em 2026-07-06 (script
// standalone, NUNCA rodado a partir do package.json principal do Next.js —
// depende de "xml-crypto", que não é dependência do app). Não contém
// nenhum segredo: senha/caminho do certificado ficam de fora de propósito.
// Resultado real desse teste: SEFAZ-BA aceitou a assinatura/estrutura e
// respondeu cStat=702 "NFC-e não é aceita pela UF do Emitente" — ou seja,
// rejeitado só por falta de credenciamento/CSC da loja (não por bug de
// código). Ver AGENTS.md ("Integração fiscal, planejada") pro relato
// completo. Preservado aqui só como referência técnica de como montar
// chave de acesso, XML, assinatura e envio SOAP — não é código de
// produção, não está integrado ao app.
//
// SEMPRE tpAmb=2 (homologacao) -- nunca mudar pra 1 (producao) neste script.
//
// Pra rodar de novo: `npm install xml-crypto` numa pasta a parte (nao
// no repo principal), extrair cert/key do .pfx via:
//   openssl pkcs12 -in certificado.pfx -passin pass:SENHA -clcerts -nokeys -out cert.pem
//   openssl pkcs12 -in certificado.pfx -passin pass:SENHA -nocerts -nodes -out key.pem
// e montar a cadeia completa (o .pfx normalmente só tem o certificado
// "folha", sem a CA intermediária — sem a cadeia completa, o IIS da
// SEFAZ rejeita o handshake mTLS com 403 antes mesmo de olhar o SOAP):
//   openssl x509 -in cert.pem -noout -text | grep "CA Issuers" # acha a URL do .p7b da AC
//   curl -o ac-issuer.p7b <url encontrada acima>
//   openssl pkcs7 -inform DER -in ac-issuer.p7b -print_certs -out ac-chain.pem
//   cat cert.pem ac-chain.pem > cert-com-cadeia.pem
//
// Loja usada neste teste: Vieras e Vinhos / Vinhas e Vinhetos Distribuidoras LTDA
// CNPJ: 50493129000157 -- Mata de Sao Joao/BA (cUF=29)

import fs from 'node:fs';
import https from 'node:https';
import { SignedXml } from 'xml-crypto';

const TP_AMB = 2; // 2 = HOMOLOGACAO. NUNCA 1.
const CUF = 29; // Bahia
const CNPJ = '50493129000157';
const CMUN = '2921005'; // Mata de Sao Joao/BA (IBGE)
const IE = 'ISENTO'; // ajustar se necessario -- ISENTO como fallback seguro pra teste

const certPem = fs.readFileSync('./cert.pem', 'utf8');
const certChainPem = fs.readFileSync('./cert-com-cadeia.pem', 'utf8'); // leaf + AC Consulti + AC RFB + raiz
const keyPem = fs.readFileSync('./key.pem', 'utf8');
// certificado sem cabecalho PEM (base64 puro) pra dentro do XML se precisar (nao usamos aqui, so pro TLS)

function pad(n, len) {
  return String(n).padStart(len, '0');
}

// Modulo 11 padrao NFe: pesos 2..9 ciclando da direita pra esquerda.
function calcDV(chave43) {
  const digits = chave43.split('').reverse().map(Number);
  let sum = 0;
  let weight = 2;
  for (const d of digits) {
    sum += d * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const resto = sum % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function gerarChaveAcesso({ cUF, aamm, cnpj, mod, serie, nNF, tpEmis, cNF }) {
  const semDV =
    pad(cUF, 2) + aamm + pad(cnpj, 14) + pad(mod, 2) + pad(serie, 3) + pad(nNF, 9) + pad(tpEmis, 1) + pad(cNF, 8);
  if (semDV.length !== 43) throw new Error(`chave sem DV com tamanho errado: ${semDV.length}`);
  const dv = calcDV(semDV);
  return semDV + dv;
}

const now = new Date();
const aamm = pad(now.getFullYear() % 100, 2) + pad(now.getMonth() + 1, 2);
const cNF = pad(Math.floor(Math.random() * 99999999), 8);
const nNF = 1; // numero sequencial -- teste, comeca em 1
const serie = 1;

const chave = gerarChaveAcesso({ cUF: CUF, aamm, cnpj: CNPJ, mod: 65, serie, nNF, tpEmis: 1, cNF });
console.log('Chave de acesso gerada:', chave, '(', chave.length, 'digitos )');

// dhEmi no formato NFe: AAAA-MM-DDTHH:MM:SS-03:00
function dhEmiAgora() {
  const iso = now.toISOString(); // UTC
  const local = new Date(now.getTime() - 3 * 3600 * 1000); // aproximacao -03:00, so pra teste
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1, 2);
  const d = pad(now.getDate(), 2);
  const h = pad(now.getHours(), 2);
  const mi = pad(now.getMinutes(), 2);
  const s = pad(now.getSeconds(), 2);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}-03:00`;
}

// Regra obrigatoria da SEFAZ em homologacao: o nome do emitente tem que ser
// substituido por esse texto fixo, senao a nota e' rejeitada.
const xNomeHomolog = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

const infNFeId = `NFe${chave}`;

const nfeXml = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="${infNFeId}" versao="4.00"><ide><cUF>${CUF}</cUF><cNF>${cNF}</cNF><natOp>Venda ao consumidor</natOp><mod>65</mod><serie>${serie}</serie><nNF>${nNF}</nNF><dhEmi>${dhEmiAgora()}</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>${CMUN}</cMunFG><tpImp>4</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>${TP_AMB}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>teste-1.0</verProc></ide><emit><CNPJ>${CNPJ}</CNPJ><xNome>${xNomeHomolog}</xNome><enderEmit><xLgr>Rua Teste Homologacao</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>${CMUN}</cMun><xMun>Mata de Sao Joao</xMun><UF>BA</UF><CEP>48280000</CEP><cPais>1058</cPais><xPais>Brasil</xPais></enderEmit><IE>${IE}</IE><CRT>1</CRT></emit><det nItem="1"><prod><cProd>001</cProd><cEAN>SEM GTIN</cEAN><xProd>Produto Teste Homologacao</xProd><NCM>22042100</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>1.00</vUnCom><vProd>1.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>1.0000</qTrib><vUnTrib>1.00</vUnTrib><indTot>1</indTot></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det><total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>1.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>1.00</vNF></ICMSTot></total><transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>1.00</vPag></detPag></pag><infAdic><infCpl>NOTA DE TESTE EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</infCpl></infAdic></infNFe></NFe>`;

fs.writeFileSync('nfce-sem-assinatura.xml', nfeXml);
console.log('XML sem assinatura gravado em nfce-sem-assinatura.xml');

// ─── Assinatura digital (XMLDSig, enveloped, padrao NFe: SHA1) ─────────────
const sig = new SignedXml({
  privateKey: keyPem,
  publicCert: certPem,
});
sig.addReference({
  xpath: `//*[local-name(.)='infNFe']`,
  transforms: [
    'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
    'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  ],
  digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  uri: `#${infNFeId}`,
});
sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';

sig.computeSignature(nfeXml, {
  location: { reference: `//*[local-name(.)='infNFe']`, action: 'after' },
});

const signedXml = sig.getSignedXml();
fs.writeFileSync('nfce-assinada.xml', signedXml);
console.log('XML assinado gravado em nfce-assinada.xml');

// ─── Envio via NFeAutorizacao4 (SOAP 1.2), sincrono ────────────────────────
const enviNFe = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc>${signedXml}</enviNFe>`;

const soapBody = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${enviNFe}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;

fs.writeFileSync('soap-envio.xml', soapBody);

const options = {
  hostname: 'hnfe.sefaz.ba.gov.br',
  path: '/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx',
  method: 'POST',
  cert: certChainPem, // leaf + cadeia completa -- o .pfx so tinha o leaf, IIS parece exigir a cadeia inteira no handshake mTLS
  key: keyPem,
  // rejectUnauthorized:false -- so pra este teste pontual em homologacao:
  // curl (via schannel do Windows) valida a cadeia normal, mas o bundle de
  // CA padrao do Node nao inclui a cadeia ICP-Brasil que esse servidor usa.
  rejectUnauthorized: false,
  headers: {
    'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
    'Content-Length': Buffer.byteLength(soapBody),
  },
  timeout: 20000,
};

console.log('\nEnviando pra SEFAZ-BA homologacao (NFeAutorizacao4)...\n');

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    console.log('HTTP status:', res.statusCode);
    fs.writeFileSync('resposta-sefaz.xml', data);
    console.log('\n--- RESPOSTA DA SEFAZ-BA ---\n');
    console.log(data);
  });
});

req.on('error', (e) => {
  console.error('Erro na requisicao:', e.message);
});
req.on('timeout', () => {
  console.error('Timeout na requisicao.');
  req.destroy();
});

req.write(soapBody);
req.end();
