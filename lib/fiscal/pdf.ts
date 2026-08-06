// node-sped-pdf (v1.0.66, node_modules/node-sped-pdf/dist/index.js) não publica
// .d.ts nem tem campo "types" no package.json — daí o @ts-expect-error abaixo
// (só pra silenciar TS7016 "implicitly has an 'any' type") + os casts pros
// tipos reais, deduzidos lendo o source compilado direto (não o README).
//
// Confirmado lendo dist/index.js: DANFe/DANFCe são funções nomeadas exportadas
// (bate com o README), cada uma termina em `resolve(await PDF.doc.save())` — ou
// seja, o retorno real é o que `pdf-lib` devolve em `PDFDocument.save()`:
// Promise<Uint8Array>, NUNCA Buffer nem string base64. Confirmado na prática
// chamando DANFe/DANFCe com um nfeProc fake (estrutura válida, dado fictício,
// não é documento fiscal real): `result.constructor.name === 'Uint8Array'`,
// `Buffer.isBuffer(result) === false`, primeiros bytes `%PDF-1.7` (PDF válido).
// Isso corrige a suposição original do plano ("Buffer ou base64 dependendo da
// versão") — nunca veio base64; um `Buffer.from(str, 'base64')` num Uint8Array
// binário corromperia o PDF (trataria bytes crus como texto base64).
// @ts-expect-error node-sped-pdf não publica tipos, ver nota acima
import { DANFe as danfeRaw, DANFCe as danfceRaw } from 'node-sped-pdf';

type GerarPdfFn = (data: { xml: string }) => Promise<Uint8Array>;
const DANFe: GerarPdfFn = danfeRaw;
const DANFCe: GerarPdfFn = danfceRaw;

// Gera o PDF (DANFE pra NF-e modelo 55, DANFCe/cupom pra NFC-e modelo 65) a
// partir do XML autorizado completo (nfeProc = NFe assinada + protNFe, ver
// montarNfeProc abaixo). `Buffer.from(resultado)` copia os bytes crus do
// Uint8Array pra um Buffer de verdade — NÃO decodifica base64, já que o dado
// já é binário (ver nota no topo do arquivo).
export async function gerarPdfNota(modelo: '55' | '65', nfeProcXml: string): Promise<Buffer> {
  const gerar = modelo === '55' ? DANFe : DANFCe;
  const resultado = await gerar({ xml: nfeProcXml });
  return Buffer.isBuffer(resultado) ? resultado : Buffer.from(resultado);
}

// Monta o nfeProc (NFe assinada com infNFeSupl + protNFe da SEFAZ) que tanto
// gerarPdfNota quanto qualquer consulta/arquivamento posterior esperam.
// Testado no shape real: node-sped-pdf normaliza o XML removendo o wrapper
// nfeProc/protNFe e funde os campos de infProt junto com NFe/infNFe antes de
// renderizar — a concatenação simples abaixo é o formato que a lib espera.
export function montarNfeProc(xmlAssinadoComSupl: string, protXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${xmlAssinadoComSupl}${protXml}</nfeProc>`;
}
