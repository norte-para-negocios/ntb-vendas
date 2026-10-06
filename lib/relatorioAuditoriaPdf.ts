// PDF A4 do relatório diário de auditoria (hora a hora, uma seção por login). Ver lib/relatorioAuditoria.ts.
import PDFDocument from 'pdfkit';
import { horaBR, type SecaoLogin } from '@/lib/relatorioAuditoria';

export function gerarPdfAuditoria(opts: { loja: string; dia: string; secoes: SecaoLogin[] }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Auditoria ${opts.dia} — ${opts.loja}` } });
    const partes: Buffer[] = [];
    doc.on('data', (c) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const [y, m, d] = opts.dia.split('-');
    const largura = doc.page.width - 80;
    doc.font('Helvetica-Bold').fontSize(16).text(`Auditoria de funcionários — ${d}/${m}/${y}`);
    doc.font('Helvetica').fontSize(11).fillColor('#444').text(opts.loja);
    doc.moveDown(0.3).fontSize(8.5).fillColor('#777').text('Registra quem fez cada ação no sistema (o login informado pelo aparelho). Linhas em vermelho = ação para conferir (cancelamento, reimpressão, exclusão, pagamento/taxa alterados, turno de caixa, acesso negado).', { width: largura });
    doc.moveDown(0.8).fillColor('black');

    if (!opts.secoes.length) { doc.fontSize(11).text('Nenhuma ação registrada neste dia.'); doc.end(); return; }

    doc.font('Helvetica-Bold').fontSize(12).text('Resumo por login');
    doc.moveDown(0.3).font('Helvetica').fontSize(10);
    for (const s of opts.secoes) {
      doc.fillColor(s.alertas ? '#b42318' : 'black').text(`${s.nome}${s.papel ? ` (${s.papel})` : ''} — ${s.total} ações, ${horaBR(s.primeira).slice(0, 5)} às ${horaBR(s.ultima).slice(0, 5)}${s.alertas ? `, ${s.alertas} para conferir` : ''}`, { width: largura });
    }
    doc.fillColor('black');

    for (const s of opts.secoes) {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(13).text(`${s.nome}${s.papel ? ` — ${s.papel}` : ''}`);
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(`${s.total} ações · primeira ${horaBR(s.primeira)} · última ${horaBR(s.ultima)}`);
      doc.moveDown(0.5).fillColor('black');
      for (const l of s.linhas) {
        if (doc.y > doc.page.height - 60) doc.addPage();
        const y0 = doc.y;
        doc.font('Helvetica').fontSize(8.5).fillColor('#666').text(l.hora, 40, y0, { width: 50, lineBreak: false });
        doc.font(l.alerta ? 'Helvetica-Bold' : 'Helvetica').fillColor(l.alerta ? '#b42318' : 'black').text(l.texto, 95, y0, { width: largura - 55 });
        doc.moveDown(0.15);
      }
    }
    doc.end();
  });
}
