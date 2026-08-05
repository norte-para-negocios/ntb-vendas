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

export function inserirSuplNoXmlAssinado(xmlAssinado: string, supl: string): string {
  return xmlAssinado.replace('<Signature', supl + '<Signature');
}
