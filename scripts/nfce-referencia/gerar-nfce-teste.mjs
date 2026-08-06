// REFERENCIA tecnica de emissao de NFC-e (modelo 65) em HOMOLOGACAO.
// Script standalone -- NUNCA rodado a partir do package.json principal do
// Next.js (depende de "xml-crypto", que nao e' dependencia do app). Nao
// contem nenhum segredo: certificado, senha e CSC vem de fora (env/arquivo).
//
// SEMPRE tpAmb=2 (homologacao) -- nunca mudar pra 1 (producao) neste script.
//
// ─── HISTORICO IMPORTANTE (ler antes de mexer) ────────────────────────────
// A versao anterior deste arquivo mandava a NFC-e pro
// `hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4` e batia sempre em
// `cStat=702` "NFC-e nao e aceita pela UF do Emitente". Isso foi
// interpretado (3x, entre 06/07 e 03/08/2026) como pendencia administrativa
// de credenciamento/"Emissor: Nao" na SEFAZ-BA. ERRADO.
//
// A Bahia delega o modelo 65 pra SEFAZ VIRTUAL DO RS (SVRS) -- ver
// `storage/autorizadores.json` do repo nfephp-org/sped-nfe: no bloco "65",
// "BA": "SVRS" (so' o modelo 55 e' "BA": "BA", infra propria). O endpoint
// da BA e' de NF-e modelo 55; ele rejeitava a NFC-e corretamente.
//
// Apontando pro SVRS, a mesma loja (com `Emissor: Nao` visivel no painel
// efisc.sefaz.ba.gov.br) foi AUTORIZADA em 04/08/2026: cStat=100.
// Ver AGENTS.md ("Atualizacao 2026-08-04") pro relato completo.
//
// ─── Preparo ──────────────────────────────────────────────────────────────
// Numa pasta a parte (NAO no repo):
//   npm install xml-crypto
//   openssl pkcs12 -in cert.pfx -passin pass:SENHA -clcerts -nokeys -legacy -out cert.pem
//   openssl pkcs12 -in cert.pfx -passin pass:SENHA -nocerts -nodes -legacy -out key.pem
// O .pfx normalmente so' tem o certificado "folha"; sem a cadeia completa o
// IIS/servidor da SEFAZ derruba o handshake mTLS antes de olhar o SOAP:
//   openssl x509 -in cert.pem -noout -text | grep "CA Issuers"   # URL do .p7b da AC
//   curl -o ac.p7b <url acima>
//   openssl pkcs7 -inform DER -in ac.p7b -print_certs -out ac-chain.pem
//   cat cert.pem ac-chain.pem > cert-chain.pem
//
// Rodar:  CSC=<csc-de-homologacao> ID_CSC=1 node gerar-nfce-teste.mjs

import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import { SignedXml } from 'xml-crypto';

const TP_AMB = 2; // 2 = HOMOLOGACAO. NUNCA 1.
const CUF = 29; // Bahia

// Emitente -- trocar pelos dados reais da loja. IE/endereco saem de
// CadConsultaCadastro4 (consulta pura, nao cria documento nenhum).
const CNPJ = process.env.CNPJ ?? '00000000000000';
const IE = process.env.IE ?? '000000000';
const XNOME = process.env.XNOME ?? 'RAZAO SOCIAL DA LOJA';
const CMUN = '2921005'; // Mata de Sao Joao/BA (IBGE)
const XMUN = 'MATA DE SAO JOAO';

// CSC/CSCID de homologacao: vem do painel efisc.sefaz.ba.gov.br. NUNCA
// hardcodar aqui -- no app, mora em `store_fiscal_config_secrets`.
const CSC = process.env.CSC;
const ID_CSC = process.env.ID_CSC ?? '1';
if (!CSC) throw new Error('defina CSC=<csc de homologacao> no ambiente');

// Autorizador de NFC-e da BA = SVRS (NAO os webservices da propria BA).
const URL_AUTORIZACAO = 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
const URL_QRCODE = 'http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx';
const URL_CHAVE = 'http://hinternet.sefaz.ba.gov.br/nfce/consulta';

// Em homologacao, o texto obrigatorio vai no xProd do PRIMEIRO item (a NFC-e
// nao tem <dest>, que e' onde a NF-e modelo 55 poe o texto equivalente).
const XPROD_HOMOLOG = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

const certPem = fs.readFileSync('./cert.pem', 'utf8');
const chainPem = fs.readFileSync('./cert-chain.pem', 'utf8');
const keyPem = fs.readFileSync('./key.pem', 'utf8');

const pad = (n, len) => String(n).padStart(len, '0');

// Modulo 11 padrao NFe: pesos 2..9 ciclando da direita pra esquerda.
function calcDV(chave43) {
  let sum = 0;
  let weight = 2;
  for (const d of chave43.split('').reverse().map(Number)) {
    sum += d * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const resto = sum % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const now = new Date();
const aamm = pad(now.getFullYear() % 100, 2) + pad(now.getMonth() + 1, 2);
const cNF = pad(Math.floor(Math.random() * 99999999), 8);
const serie = Number(process.env.SERIE ?? 1);
const nNF = Number(process.env.NNF ?? 1);
const semDV = `${pad(CUF, 2)}${aamm}${pad(CNPJ, 14)}65${pad(serie, 3)}${pad(nNF, 9)}1${cNF}`;
const chave = semDV + calcDV(semDV);

const dhEmi =
  `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}` +
  `T${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}:${pad(now.getSeconds(), 2)}-03:00`;

const infNFeId = `NFe${chave}`;

// ORDEM DO SCHEMA: ide, emit, [dest], autXML, det, total, transp, pag.
// autXML depois de pag da' cStat=225 "Falha no Schema XML".
// autXML com o CNPJ da propria SEFAZ-BA e' o fallback que a rejeicao 486
// sugere pra quem nao informa escritorio de contabilidade.
const nfeXml =
  `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="${infNFeId}" versao="4.00">` +
  `<ide><cUF>${CUF}</cUF><cNF>${cNF}</cNF><natOp>VENDA AO CONSUMIDOR</natOp><mod>65</mod>` +
  `<serie>${serie}</serie><nNF>${nNF}</nNF><dhEmi>${dhEmi}</dhEmi><tpNF>1</tpNF><idDest>1</idDest>` +
  `<cMunFG>${CMUN}</cMunFG><tpImp>4</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV>` +
  `<tpAmb>${TP_AMB}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres>` +
  `<procEmi>0</procEmi><verProc>ntb-vendas-referencia-1.0</verProc></ide>` +
  `<emit><CNPJ>${CNPJ}</CNPJ><xNome>${XNOME}</xNome>` +
  `<enderEmit><xLgr>RUA DA AURORA</xLgr><nro>S/N</nro><xBairro>PRAIA DO FORTE</xBairro>` +
  `<cMun>${CMUN}</cMun><xMun>${XMUN}</xMun><UF>BA</UF><CEP>48280000</CEP>` +
  `<cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit><IE>${IE}</IE><CRT>1</CRT></emit>` +
  `<autXML><CNPJ>13937073000156</CNPJ></autXML>` +
  `<det nItem="1"><prod><cProd>001</cProd><cEAN>SEM GTIN</cEAN><xProd>${XPROD_HOMOLOG}</xProd>` +
  `<NCM>21069090</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>1.0000000000</vUnCom>` +
  `<vProd>1.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>1.0000</qTrib>` +
  `<vUnTrib>1.0000000000</vUnTrib><indTot>1</indTot></prod>` +
  `<imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>` +
  `<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>` +
  `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP>` +
  `<vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>1.00</vProd>` +
  `<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI>` +
  `<vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro>` +
  `<vNF>1.00</vNF></ICMSTot></total><transp><modFrete>9</modFrete></transp>` +
  `<pag><detPag><indPag>0</indPag><tPag>01</tPag><vPag>1.00</vPag></detPag></pag>` +
  `</infNFe></NFe>`;

// ─── Assinatura digital (XMLDSig enveloped, padrao NFe: C14N + SHA1) ───────
const sig = new SignedXml({ privateKey: keyPem, publicCert: certPem });
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
sig.computeSignature(nfeXml, { location: { reference: `//*[local-name(.)='infNFe']`, action: 'after' } });
const assinado = sig.getSignedXml();

// ─── QR Code (versao 2, modo online) ──────────────────────────────────────
// p=<chave>|2|<tpAmb>|<idCSC sem zeros a esquerda>|<SHA1 maiusculo>
// hash = SHA1("<chave>|2|<tpAmb>|<idCSC>" + CSC)
// A SEFAZ VALIDA esse hash: CSC errado devolve cStat=464 "Codigo de Hash no
// QR-Code difere do calculado".
const paramsQr = `${chave}|2|${TP_AMB}|${String(Number(ID_CSC))}`;
const hashQr = crypto.createHash('sha1').update(paramsQr + CSC, 'utf8').digest('hex').toUpperCase();
const qrCode = `${URL_QRCODE}?p=${paramsQr}|${hashQr}`;

// infNFeSupl fica ENTRE infNFe e Signature (ordem do schema). Inserir depois
// de assinar nao invalida nada: o digest cobre so' o subtree de infNFe.
const supl = `<infNFeSupl><qrCode><![CDATA[${qrCode}]]></qrCode><urlChave>${URL_CHAVE}</urlChave></infNFeSupl>`;
const nfeCompleta = assinado.replace('<Signature', supl + '<Signature');

const enviNFe =
  `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
  `<idLote>1</idLote><indSinc>1</indSinc>${nfeCompleta}</enviNFe>`;

const soapBody =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
  `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${enviNFe}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;

console.log('Chave de acesso:', chave);
console.log('Enviando pro SVRS (autorizador de NFC-e da BA), tpAmb=2...\n');

const u = new URL(URL_AUTORIZACAO);
const req = https.request(
  {
    hostname: u.hostname,
    path: u.pathname,
    method: 'POST',
    cert: chainPem, // leaf + cadeia completa (o .pfx so' tem o leaf)
    key: keyPem,
    rejectUnauthorized: false, // bundle de CA do Node nao traz a cadeia ICP-Brasil
    headers: {
      'Content-Type':
        'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
      'Content-Length': Buffer.byteLength(soapBody),
    },
    timeout: 30000,
  },
  (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      console.log('HTTP', res.statusCode);
      fs.writeFileSync('resposta-sefaz.xml', data);
      const prot = data.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? data;
      console.log(prot.replace(/></g, '>\n<'));
      if (prot.includes('<cStat>100</cStat>')) {
        // nfeProc = NFe assinada + protocolo. E' esse o arquivo fiscal final
        // (e o que o node-sped-pdf consome pra gerar o DANFE NFC-e).
        fs.writeFileSync(
          `proc-${chave}.xml`,
          `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nfeCompleta}${prot}</nfeProc>`,
        );
        console.log(`\nAUTORIZADA. nfeProc gravado em proc-${chave}.xml`);
      }
    });
  },
);
req.on('error', (e) => console.error('Erro na requisicao:', e.message));
req.on('timeout', () => {
  console.error('Timeout.');
  req.destroy();
});
req.write(soapBody);
req.end();
