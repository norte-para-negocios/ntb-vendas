// Geração dos documentos impressos (tickets de cozinha/bar, comprovante de mesa/balcão,
// relatório de vendas). Antes o ticket de cozinha e o de bar eram uma cópia exata um do
// outro (só o título mudava) e cada função duplicava o mesmo bloco de HTML/CSS inline.

// Nome do cliente e observação do pedido são texto livre digitado pelo cliente final e
// vão parar aqui sem passar por nenhum framework de render (é document.write puro) — sem
// escapar, é XSS armazenado (achado de segurança #4 da varredura de 2026-07-02). Aplicada
// em toda interpolação de string dentro dos templates abaixo, mesmo em valores hoje
// controlados internamente (nome de produto/loja), porque escapar não tem custo.
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const THERMAL_STYLES = `
  body { font-family: 'Courier New', Courier, monospace; width: 100%; max-width: 48mm; margin: 0; padding: 0; font-size: 10px; color: #000; }
  .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 3px; margin-bottom: 6px; }
  .store-name { font-size: 12px; font-weight: bold; text-transform: uppercase; }
  .doc-title { font-size: 11px; font-weight: bold; text-transform: uppercase; margin-top: 2px; }
  .meta { font-size: 8px; color: #333; margin-top: 2px; }
  .info { margin-bottom: 6px; border-bottom: 1px dashed #000; padding-bottom: 6px; text-align: center; }
  .big-text { font-size: 12px; font-weight: bold; }
  .item-line { font-size: 12px; font-weight: bold; margin: 6px 0; line-height: 1.2; }
  .addons { font-size: 11px; font-weight: bold; margin-top: -3px; margin-bottom: 3px; }
  .obs { margin-top: 3px; font-size: 10px; text-transform: uppercase; }
  .items-table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 6px; border-bottom: 1px dashed #000; padding-bottom: 2px; }
  .items-table th { border-bottom: 1px dashed #000; padding-bottom: 3px; text-align: left; font-weight: normal; }
  .items-table th.right, .items-table td.right { text-align: right; }
  .items-table td { padding: 3px 0; vertical-align: top; }
  .items-table td.right { white-space: nowrap; padding-left: 5px; }
  .summary-table { width: 100%; border-collapse: collapse; font-size: 10px; }
  .summary-table td { padding: 2px 0; }
  .summary-table td.right { text-align: right; white-space: nowrap; padding-left: 5px; }
  .total { border-top: 1px dashed #000; margin-top: 6px; padding-top: 5px; font-size: 13px; font-weight: bold; text-align: right; }
  .footer { border-top: 1px dashed #000; margin-top: 10px; padding-top: 5px; text-align: center; font-size: 9px; color: #333; }
  @media print { @page { margin: 0; size: auto; } body { margin: 0; padding: 0; } }
`;

function openThermalPrint(title: string, bodyHtml: string) {
  const printWindow = window.open('', '_blank', 'width=300,height=500,noopener');
  if (!printWindow) return;
  printWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>${THERMAL_STYLES}</style>
      </head>
      <body>${bodyHtml}</body>
    </html>
  `);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
    printWindow.onafterprint = () => printWindow.close();
  }, 500);
}

export function printKitchenTicket(opts: {
  kind: 'COZINHA' | 'BAR';
  storeName?: string;
  orderType: string;
  identifier: string;
  client?: string | null;
  quantity: number;
  productName: string;
  addons?: string;
  observation?: string;
  orderIdShort: string;
}) {
  const body = `
    <div class="header">
      ${opts.storeName ? `<div class="store-name">${escapeHtml(opts.storeName)}</div>` : ''}
      <div class="doc-title">${escapeHtml(opts.kind)}</div>
      <div class="meta">${new Date().toLocaleString()}</div>
    </div>
    <div class="info">
      <div class="big-text">${escapeHtml(opts.orderType)}: ${escapeHtml(opts.identifier)}</div>
      ${opts.client ? `<div>Cliente: ${escapeHtml(opts.client)}</div>` : ''}
    </div>
    <div class="item-line">${opts.quantity}x ${escapeHtml(opts.productName)}</div>
    ${opts.addons ? `<div class="addons">Adicional: ${escapeHtml(opts.addons)}</div>` : ''}
    ${opts.observation ? `<div class="obs">OBS: ${escapeHtml(opts.observation)}</div>` : ''}
    <div class="footer">Pedido #${escapeHtml(opts.orderIdShort)}</div>
  `;
  openThermalPrint(`Ticket ${opts.kind === 'COZINHA' ? 'Cozinha' : 'Bar'}`, body);
}

export interface BillReceiptItem {
  quantity: number;
  name: string;
  total: number;
}

export function printBillReceipt(opts: {
  storeName: string;
  cnpj?: string | null;
  label: string;
  items: BillReceiptItem[];
  subtotal: number;
  serviceFee?: number;
  total: number;
}) {
  const body = `
    <div class="header">
      <div class="store-name">${escapeHtml(opts.storeName)}</div>
      <div class="meta">CNPJ: ${escapeHtml(opts.cnpj || 'não informado')}</div>
      <div class="meta">${new Date().toLocaleString()}</div>
    </div>
    <div class="info"><div class="big-text">${escapeHtml(opts.label)}</div></div>
    <table class="items-table">
      <thead>
        <tr><th style="width:15%">QTD</th><th style="width:55%">ITEM</th><th class="right" style="width:30%">R$</th></tr>
      </thead>
      <tbody>
        ${opts.items
          .map(
            (i) => `
          <tr>
            <td>${i.quantity}x</td>
            <td style="padding-right:4px;">${escapeHtml(i.name)}</td>
            <td class="right">${i.total.toFixed(2)}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
    ${
      opts.serviceFee
        ? `<table class="summary-table">
            <tr><td>Subtotal</td><td class="right">R$ ${opts.subtotal.toFixed(2)}</td></tr>
            <tr><td>Taxa de Serviço (10%)</td><td class="right">R$ ${opts.serviceFee.toFixed(2)}</td></tr>
          </table>`
        : ''
    }
    <div class="total">TOTAL: R$ ${opts.total.toFixed(2)}</div>
    <div class="footer">Obrigado pela preferência!</div>
  `;
  openThermalPrint(`Comprovante - ${opts.label}`, body);
}

const REPORT_STYLES = `
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; font-size: 13px; }
  .report-header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .report-header h1 { font-size: 20px; margin: 0 0 4px; }
  .report-header p { margin: 2px 0; color: #444; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; }
  th { background: #f3f3f3; text-transform: uppercase; font-size: 11px; letter-spacing: .02em; }
  td.right, th.right { text-align: right; }
  tfoot td { font-weight: bold; border-top: 2px solid #111; }
  .items-summary-row td { padding-top: 0; padding-bottom: 8px; font-size: 11px; color: #555; font-style: italic; }
  @media print { @page { margin: 16mm; } }
`;

export interface SalesReportRow {
  date: string;
  type: string;
  customer: string;
  items: number;
  // Texto livre listando os itens vendidos na linha (produto + adicional,
  // ex.: "2x Pizza Marguerita (Catupiry), 1x Coca-Cola"). Opcional pra não
  // quebrar quem ainda só manda a contagem em `items`.
  itemsSummary?: string;
  total: number;
}

export function printSalesReport(opts: {
  storeName: string;
  periodLabel: string;
  rows: SalesReportRow[];
  totalRevenue: number;
}) {
  const printWindow = window.open('', '_blank', 'width=900,height=700,noopener');
  if (!printWindow) return;
  const body = `
    <div class="report-header">
      <h1>${escapeHtml(opts.storeName)}</h1>
      <p>Relatório de Vendas</p>
      <p>${escapeHtml(opts.periodLabel)} · ${opts.rows.length} ${opts.rows.length === 1 ? 'venda' : 'vendas'}</p>
    </div>
    <table>
      <thead>
        <tr><th>Data</th><th>Tipo</th><th>Cliente / Mesa</th><th class="right">Itens</th><th class="right">Total</th></tr>
      </thead>
      <tbody>
        ${opts.rows
          .map(
            (r) => `
          <tr>
            <td>${escapeHtml(r.date)}</td>
            <td>${escapeHtml(r.type)}</td>
            <td>${escapeHtml(r.customer)}</td>
            <td class="right">${r.items}</td>
            <td class="right">R$ ${r.total.toFixed(2)}</td>
          </tr>
          ${r.itemsSummary ? `<tr class="items-summary-row"><td colspan="5">${escapeHtml(r.itemsSummary)}</td></tr>` : ''}`
          )
          .join('')}
      </tbody>
      <tfoot>
        <tr><td colspan="4">Total do período</td><td class="right">R$ ${opts.totalRevenue.toFixed(2)}</td></tr>
      </tfoot>
    </table>
  `;
  printWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(`Relatório de Vendas - ${opts.storeName}`)}</title>
        <style>${REPORT_STYLES}</style>
      </head>
      <body>${body}</body>
    </html>
  `);
  printWindow.document.close();
  setTimeout(() => printWindow.print(), 400);
}
