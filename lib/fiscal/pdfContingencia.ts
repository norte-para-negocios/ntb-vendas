import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface DadosPdfContingencia {
  storeName: string;
  cnpj: string;
  endereco?: string;
  chave: string;
  dataHora: Date;
  itens: { descricao: string; quantidade: number; valorUnitario: number; valorTotal: number }[];
  valorTotal: number;
  via: 1 | 2;
  // String já pronta do parâmetro `p=` da URL de consulta (o mesmo valor
  // devolvido em `qrCode` por `montarQrCode`/`montarQrCodeOffline`, ver
  // lib/fiscal/qrcode.ts) — quem chama decide qual fórmula usar; este
  // módulo só desenha o que recebe. Opcional porque nem toda emissão de
  // contingência é NFC-e (modelo 65); NF-e (modelo 55) não tem QR Code.
  qrCode?: string;
}

const LARGURA_MM = 80;
const MM_PARA_PT = 2.834645669;
const LARGURA_PT = LARGURA_MM * MM_PARA_PT;
// ~30mm — no piso do que ainda é confortavelmente legível por leitor de
// celular numa impressão térmica 80mm (abaixo disso o módulo do QR fica
// pequeno demais e a taxa de erro de leitura sobe rápido).
const QR_LADO_PT = 30 * MM_PARA_PT;

function formatarChave(chave: string): string {
  return chave.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatarBRL(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}

// Cupom de contingência (NFC-e emitida com tpEmis=9, SEM protocolo da
// SEFAZ ainda) — layout próprio porque `nfe-danfe-pdf` (usado pro cupom
// normal, ver lib/fiscal/pdf.ts) exige protNFe.infProt e quebra sem ele.
// Aviso legal obrigatório em destaque. Inclui QR Code quando `dados.qrCode`
// vem preenchido (NFC-e, modelo 65): já existe fórmula pra montar o QR
// de contingência sem protocolo (`montarQrCodeOffline`, NT 2015/002, ver
// lib/fiscal/qrcode.ts — usa dia+vNF+DigestValue no lugar de CSC+chave só,
// dispensando o protocolo que só chega depois da retransmissão), então o
// cupom físico do cliente pode carregar o mesmo QR que uma NFC-e online
// carregaria, permitindo conferência antes mesmo da autorização da SEFAZ.
export async function gerarPdfContingencia(dados: DadosPdfContingencia): Promise<Buffer> {
  // Gerado ANTES de abrir o PDFDocument: `doc.image()` precisa do buffer
  // PNG já pronto em mãos (é síncrono), e `QRCode.toBuffer` é assíncrono.
  const qrCodePng = dados.qrCode
    ? await QRCode.toBuffer(dados.qrCode, { type: 'png', margin: 1, errorCorrectionLevel: 'M' })
    : null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [LARGURA_PT, 1000], margins: { top: 10, bottom: 10, left: 8, right: 8 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const largura = LARGURA_PT - 16;

    doc.font('Helvetica-Bold').fontSize(9).text(dados.storeName.toUpperCase(), { width: largura, align: 'center' });
    doc.font('Helvetica').fontSize(7).text(`CNPJ: ${dados.cnpj}`, { width: largura, align: 'center' });
    if (dados.endereco) doc.text(dados.endereco, { width: largura, align: 'center' });
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fontSize(8).fillColor('black').text(
      'EMITIDO EM CONTINGENCIA - DOCUMENTO SEM VALIDACAO DA SEFAZ NO MOMENTO DA EMISSAO',
      { width: largura, align: 'center' },
    );
    doc.font('Helvetica').fontSize(7).text(
      dados.dataHora.toLocaleString('pt-BR'),
      { width: largura, align: 'center' },
    );
    doc.moveDown(0.3);
    doc.text('-'.repeat(42), { width: largura });

    doc.font('Helvetica').fontSize(7);
    for (const item of dados.itens) {
      doc.text(
        `${item.quantidade}x ${item.descricao} - R$ ${formatarBRL(item.valorTotal)}`,
        { width: largura },
      );
    }
    doc.text('-'.repeat(42), { width: largura });
    doc.font('Helvetica-Bold').text(`TOTAL: R$ ${formatarBRL(dados.valorTotal)}`, { width: largura });
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(7).text('Chave de acesso:', { width: largura });
    doc.text(formatarChave(dados.chave), { width: largura });
    doc.moveDown(0.3);
    doc.text(
      'Consulte a autorizacao desta nota, quando disponivel, pela chave de acesso no site da SEFAZ do seu estado.',
      { width: largura },
    );

    if (qrCodePng) {
      doc.moveDown(0.4);
      const x = doc.page.margins.left + (largura - QR_LADO_PT) / 2;
      const y = doc.y;
      doc.image(qrCodePng, x, y, { width: QR_LADO_PT, height: QR_LADO_PT });
      doc.y = y + QR_LADO_PT;
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(6.5).text(
        'Consulte pela camera do celular ou no site da SEFAZ do seu estado.',
        { width: largura, align: 'center' },
      );
    }

    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(8).text(
      dados.via === 1 ? '1a VIA - CLIENTE' : '2a VIA - ESTABELECIMENTO',
      { width: largura, align: 'center' },
    );

    doc.end();
  });
}
