import PDFDocument from 'pdfkit';

export interface DadosPdfContingencia {
  storeName: string;
  cnpj: string;
  endereco?: string;
  chave: string;
  dataHora: Date;
  itens: { descricao: string; quantidade: number; valorUnitario: number; valorTotal: number }[];
  valorTotal: number;
  via: 1 | 2;
}

const LARGURA_MM = 80;
const MM_PARA_PT = 2.834645669;
const LARGURA_PT = LARGURA_MM * MM_PARA_PT;

function formatarChave(chave: string): string {
  return chave.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatarBRL(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}

// Cupom de contingência (NFC-e emitida com tpEmis=9, SEM protocolo da
// SEFAZ ainda) — layout próprio porque `nfe-danfe-pdf` (usado pro cupom
// normal, ver lib/fiscal/pdf.ts) exige protNFe.infProt e quebra sem ele.
// Aviso legal obrigatório em destaque, sem QR Code de autorização (o hash
// do QR depende do CSC + protocolo, que não existem neste momento) — só
// texto com a chave de acesso pra consulta manual depois.
export function gerarPdfContingencia(dados: DadosPdfContingencia): Promise<Buffer> {
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

    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(8).text(
      dados.via === 1 ? '1a VIA - CLIENTE' : '2a VIA - ESTABELECIMENTO',
      { width: largura, align: 'center' },
    );

    doc.end();
  });
}
