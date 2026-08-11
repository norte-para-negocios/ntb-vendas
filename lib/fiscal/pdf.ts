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
// versão") — nunca veio base64 de verdade. O fallback `Buffer.from(x as
// unknown as string, 'base64')` do plano só era um cast de tipo (nunca uma
// conversão de valor); em runtime o Node ignora o argumento de encoding
// quando o 1º argumento não é uma string de verdade, então na prática não
// teria corrompido o Uint8Array de hoje — mas ainda era um tipo mentindo
// sobre o dado (Uint8Array fingindo ser string) e quebraria de verdade se
// algum dia vier uma string base64 legítima de outra origem. Evitado aqui
// tratando sempre o valor pelo que ele realmente é: bytes crus.
// @ts-expect-error node-sped-pdf não publica tipos, ver nota acima
import { DANFe as danfeRaw } from 'node-sped-pdf';
import { gerarPDF as gerarNfceDanfe } from 'nfe-danfe-pdf';

type GerarPdfFn = (data: { xml: string }) => Promise<Uint8Array>;
const DANFe: GerarPdfFn = danfeRaw;

// Coleta um PDFKit.PDFDocument (o que nfe-danfe-pdf devolve, um stream, não
// Buffer/Uint8Array como node-sped-pdf) inteiro num Buffer — a lib já chama
// `.end()` internamente antes de devolver (confirmado: o exemplo do README
// faz `pdfDoc.pipe(writeStream)` sem `.end()` manual e o stream termina
// sozinho), então só falta juntar os chunks.
function coletarPdfKitDoc(doc: Awaited<ReturnType<typeof gerarNfceDanfe>>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

// Gera o PDF (DANFE pra NF-e modelo 55, DANFCe/cupom pra NFC-e modelo 65) a
// partir do XML autorizado completo (nfeProc = NFe assinada + protNFe, ver
// montarNfeProc abaixo).
//
// **Modelos usam bibliotecas DIFERENTES de propósito** (2026-08-11, spike
// documentado em docs/plans/2026-08-10-cupom-fiscal-legibilidade.md):
// `node-sped-pdf` (NF-e, continua igual) vs. `nfe-danfe-pdf` (NFC-e, trocado).
// Motivo: `node-sped-pdf` tem 3 valores HARDCODED errados no template de
// DANFCe (protocolo sempre "000000000000000", URL de consulta sempre
// `sefaz.mt.gov.br` independente da UF real, tributos sempre zerados) —
// confirmado lendo o bundle compilado, não são bug de dado de entrada, o
// pacote nunca leu esses campos do XML. `nfe-danfe-pdf` lê os 3 corretos do
// XML de verdade (testado com uma NFC-e real autorizada desta mesma loja).
// Trade-off aceito conscientemente: em ambiente de HOMOLOGAÇÃO (só),
// `nfe-danfe-pdf` mascara o nome de TODOS os itens com o aviso obrigatório
// da SEFAZ (não só o primeiro item, como a regra realmente exige) — cosmético
// e sem risco, já que nota de homologação não tem valor fiscal; confirmado
// que em PRODUÇÃO (`tpAmb=1`) os nomes reais aparecem certos.
export async function gerarPdfNota(modelo: '55' | '65', nfeProcXml: string): Promise<Buffer> {
  if (modelo === '65') {
    const doc = await gerarNfceDanfe(nfeProcXml);
    return coletarPdfKitDoc(doc);
  }
  const resultado = await DANFe({ xml: nfeProcXml });
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
