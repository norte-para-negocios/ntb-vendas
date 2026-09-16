import crypto from 'node:crypto';

export interface DadosQrCode {
  chave: string;
  tpAmb: 2 | 1;
  idCsc: string; // sem zeros à esquerda na fórmula, mas pode vir com eles do banco
  csc: string;
  urlQrCode: string; // endpoint de consulta do QR (varia por UF/ambiente)
  urlChave: string; // endpoint de consulta por chave (varia por UF/ambiente)
}

// Versão 2, modo online: p=<chave>|2|<tpAmb>|<idCSC sem zeros à esquerda>|
// <SHA1 maiúsculo de "<chave>|2|<tpAmb>|<idCSC>"+CSC>. A SEFAZ valida esse
// hash de verdade (CSC errado devolve cStat=464) — confirmado em 2026-08-04.
export function montarQrCode(dados: DadosQrCode): { qrCode: string; supl: string } {
  const idCscSemZeros = String(Number(dados.idCsc));
  const params = `${dados.chave}|2|${dados.tpAmb}|${idCscSemZeros}`;
  const hash = crypto.createHash('sha1').update(params + dados.csc, 'utf8').digest('hex').toUpperCase();
  const qrCode = `${dados.urlQrCode}?p=${params}|${hash}`;

  // infNFeSupl entra ENTRE infNFe e Signature (ordem do schema) — inserir
  // depois de assinar não invalida nada, o digest cobre só o subtree de infNFe.
  const supl = `<infNFeSupl><qrCode><![CDATA[${qrCode}]]></qrCode><urlChave>${dados.urlChave}</urlChave></infNFeSupl>`;
  return { qrCode, supl };
}

export interface DadosQrCodeOffline extends DadosQrCode {
  dhEmi: string; // ISO-8601 do <dhEmi> da própria nota; só o dia entra na fórmula
  vNF: number | string; // valor total da nota (<vNF> do <ICMSTot>)
  digVal: string; // <DigestValue> do XML JÁ ASSINADO (base64), NÃO recalculado
}

// Extrai o DigestValue do XML assinado. Propositalmente por regex, mesma
// convenção já usada no resto do código pra ler fragmentos de XML (ver
// `xmlAssinado.match(/<protNFe[\s\S]*?<\/protNFe>/)` em
// app/api/fiscal/emitir/route.ts) — o xml-crypto emite a assinatura sem
// prefixo de namespace, mas o `(?:\w+:)?` deixa a leitura tolerante caso
// isso mude.
export function extrairDigestValue(xmlAssinado: string): string {
  const m = xmlAssinado.match(/<(?:\w+:)?DigestValue>([^<]+)<\/(?:\w+:)?DigestValue>/);
  if (!m) throw new Error('DigestValue nao encontrado no XML assinado (QR Code de contingencia).');
  return m[1].trim();
}

// Versão 2, modo OFF-LINE (tpEmis=9). Formula DIFERENTE do modo online: além
// da chave/versão/ambiente, entram o dia da emissão, o valor total e o
// DigestValue da assinatura em hexadecimal.
//
//   p = <chNFe>|2|<tpAmb>|<dia (2 díg.)>|<vNF>|<digestValue em hex>|<idCSC>
//   hash = SHA1 maiúsculo de (p + CSC)
//
// O `digVal` NÃO é recalculado: é o mesmo digest que a assinatura XMLDSig já
// produziu sobre o subtree de infNFe, lido de dentro do XML assinado. O
// "hex" é a codificação ASCII de cada caractere da string base64 (NÃO o
// base64 decodificado) — é isso que as implementações de referência
// (nfephp-org/sped-nfe, Factories/QRCode.php) fazem.
//
// Usar a fórmula ONLINE (montarQrCode) num documento tpEmis=9 produz um QR
// errado — os campos e o insumo do hash são outros.
export function montarQrCodeOffline(dados: DadosQrCodeOffline): { qrCode: string; supl: string } {
  const idCscSemZeros = String(Number(dados.idCsc));
  const dia = dados.dhEmi.slice(8, 10); // "AAAA-MM-DDThh:mm:ss-03:00" -> "DD"
  if (!/^\d{2}$/.test(dia)) throw new Error(`dhEmi inesperado para QR Code offline: ${dados.dhEmi}`);
  const valor = Number(dados.vNF).toFixed(2);
  const digHex = Buffer.from(dados.digVal, 'ascii').toString('hex');

  const params = `${dados.chave}|2|${dados.tpAmb}|${dia}|${valor}|${digHex}|${idCscSemZeros}`;
  const hash = crypto.createHash('sha1').update(params + dados.csc, 'utf8').digest('hex').toUpperCase();
  const qrCode = `${dados.urlQrCode}?p=${params}|${hash}`;

  const supl = `<infNFeSupl><qrCode><![CDATA[${qrCode}]]></qrCode><urlChave>${dados.urlChave}</urlChave></infNFeSupl>`;
  return { qrCode, supl };
}

export function inserirSuplNoXmlAssinado(xmlAssinado: string, supl: string): string {
  return xmlAssinado.replace('<Signature', supl + '<Signature');
}
