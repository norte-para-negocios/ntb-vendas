// lib/reports/fechamentoXlsx.ts
import type { Workbook, Worksheet } from 'exceljs';
import type { Order } from '@/types';
import type { CashShiftSummary } from '../api';
import { EXCEPTION_LABELS, type ExceptionEvent } from '../excecoes';
import { montarPainel, type PainelDia } from './painelDia';
import { getPaymentMethodLabel, getCardBrandLabel } from '../labels';
import { agruparPorConta, decomporVenda, type ConfigTaxa } from '../faturamento';

export interface FechamentoTurno { id?: string; /** O turno sai do período: totais só das vendas do período. */ parcial?: boolean; operador: string; abertoEm: string; fechadoEm: string | null; fundo: number; contado: number | null; resumo: CashShiftSummary }
export interface FechamentoData { /** Título da faixa (padrão: Relatório do dia). */ titulo?: string; painel?: PainelDia; nomeCategoria?: (id: string) => string | undefined; loja: string; periodoLabel: string; geradoEm: Date; geradoPor: string; turnos: FechamentoTurno[]; vendas: Order[]; excecoes: ExceptionEvent[]; /** Taxa da loja (configTaxaDaLoja); sem ela, 10%. */ configTaxa?: ConfigTaxa }

const FONT = 'Calibri';
const BRL = '"R$" #,##0.00';
const HEAD_FILL = 'FF484DB5';      // azul Norte (--brand)
const HEAD_DARK = 'FF2B2E83';
const SOFT_FILL = 'FFEEEFFB';
const BAR = 'FF9DA1E4';
export const NORTE_RODAPE = 'Norte Vendas · Norte para Negócios · norteparanegocios.com.br';

// O Excel não guarda fuso: grava o instante como relógio de parede. Desloca -3h (Bahia, sem horário de verão)
// pra célula mostrar a hora que o restaurante viveu (22h16 continua 22h16, não 01h16 do dia seguinte).
export const horaBahia = (d: Date | string): Date => new Date(new Date(d).getTime() - 3 * 3600 * 1000);

export const fechamentoFileName = (lojaSlug: string, dia: string): string => `fechamento_${dia}_${lojaSlug}.xlsx`;

// Texto que começa com = + - @ viraria fórmula no Excel (injeção de planilha).
export const safeCell = (v: string): string => (/^[=+\-@]/.test(v) ? `'${v}` : v);

function headerRow(ws: Worksheet, cols: { header: string; width: number; fmt?: string }[]) {
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
  const r = ws.getRow(1);
  r.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
  r.alignment = { vertical: 'middle' };
  r.height = 22;
  ws.properties.tabColor = { argb: HEAD_FILL };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function buildFechamentoWorkbook(d: FechamentoData): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = d.geradoPor;
  wb.created = d.geradoEm;

  const painel = d.painel ?? montarPainel(d, d.nomeCategoria);
  montarPainelSheet(wb, d, painel);

  // 2. Formas de pagamento (sempre os 4 meios) com total em fórmula
  const fp = wb.addWorksheet('Formas de pagamento');
  headerRow(fp, [{ header: 'Forma', width: 24 }, { header: 'Total', width: 18, fmt: BRL }]);
  const formas = painel.formas;
  formas.forEach((f) => fp.addRow([f.label, f.total]));
  const ultimaForma = formas.length + 1;
  const totRow = fp.addRow(['TOTAL', { formula: `SUM(B2:B${ultimaForma})`, result: formas.reduce((s, f) => s + f.total, 0) }]);
  totRow.font = { bold: true };
  totRow.getCell(2).numFmt = BRL;
  fp.autoFilter = undefined as any;

  // 3. Cartões (ordem da folha de papel)
  const ca = wb.addWorksheet('Cartões');
  headerRow(ca, [{ header: 'Bandeira', width: 30 }, { header: 'Total', width: 18, fmt: BRL }]);
  const cartoes = painel.cartoes;
  cartoes.forEach((c) => ca.addRow([c.label, c.total]));
  const ct = ca.addRow(['TOTAL', { formula: `SUM(B2:B${cartoes.length + 1})`, result: cartoes.reduce((s, c) => s + c.total, 0) }]);
  ct.font = { bold: true };
  ct.getCell(2).numFmt = BRL;

  // 4. Caixa (um turno por linha)
  if (d.turnos.length > 0) {
  const cx = wb.addWorksheet('Caixa');
  headerRow(cx, [
    { header: 'Operador', width: 22 }, { header: 'Abertura', width: 18, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'Fechamento', width: 18, fmt: 'dd/mm/yyyy hh:mm' },
    { header: 'Fundo', width: 14, fmt: BRL }, { header: 'Esperado em dinheiro', width: 20, fmt: BRL }, { header: 'Contado', width: 14, fmt: BRL }, { header: 'Diferença', width: 14, fmt: BRL },
  ]);
  d.turnos.forEach((t, i) => {
    const r = cx.addRow([safeCell(t.parcial ? `${t.operador} (turno passa do período)` : t.operador), horaBahia(t.abertoEm), t.fechadoEm ? horaBahia(t.fechadoEm) : null, t.fundo, t.resumo.expected_cash, t.contado, null]);
    if (t.contado != null) r.getCell(7).value = { formula: `F${i + 2}-E${i + 2}`, result: t.contado - t.resumo.expected_cash };
  });
  }

  // 5. Vendas: UMA linha por conta paga (pedidos da mesma conta juntos), decomposta igual ao fechamento do turno
  // (lib/faturamento.ts): itens - desconto + taxa + outras taxas + pago a mais - cortesia = recebido. Item cancelado não entra.
  const vd = wb.addWorksheet('Vendas');
  headerRow(vd, [
    { header: 'Data', width: 18, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'Mesa/Balcão', width: 12 }, { header: 'Cliente / lançado por', width: 24 }, { header: 'Operador', width: 18 },
    { header: 'Forma', width: 20 }, { header: 'Bandeira', width: 14 }, { header: 'Total dos itens', width: 16, fmt: BRL }, { header: 'Desconto', width: 12, fmt: BRL },
    { header: 'Taxa de serviço', width: 16, fmt: BRL }, { header: 'Outras taxas', width: 14, fmt: BRL }, { header: 'Pago a mais', width: 13, fmt: BRL },
    { header: 'Cortesia', width: 12, fmt: BRL }, { header: 'Recebido', width: 14, fmt: BRL }, { header: 'Status', width: 12 },
  ]);
  type Pd = { operador_nome?: string; methods?: { method: string; brand?: string; amount: number }[] };
  const contasVd = agruparPorConta(d.vendas as never[]) as Order[];
  contasVd.forEach((o) => {
    const pd = (o.payment_details ?? {}) as Pd;
    const methods = Array.isArray(pd.methods) ? pd.methods : [];
    const dc = decomporVenda(o as never, d.configTaxa);
    const status = o.status === 'canceled' ? 'Cancelada' : dc.bruto <= 0 ? 'Zerada (tudo cancelado)' : dc.recebido <= 0 ? 'Cortesia' : 'Entregue';
    vd.addRow([
      horaBahia(o.created_at), o.order_type === 'counter' ? 'Balcão' : `Mesa ${(o as any).tables?.number ?? ''}`, safeCell(o.customer_name ?? ''), safeCell(pd.operador_nome ?? ''),
      methods.map((m) => getPaymentMethodLabel(m.method)).join(' + '), methods.map((m) => (m.brand ? getCardBrandLabel(m.brand) : '')).filter(Boolean).join(' + '),
      dc.itens, dc.desconto, dc.taxa, dc.outras, dc.excesso, dc.cortesia, dc.recebido, status,
    ]);
  });
  if (contasVd.length > 0) vd.autoFilter = { from: 'A1', to: `N${contasVd.length + 1}` };

  // 6. Itens
  const it = wb.addWorksheet('Itens');
  headerRow(it, [{ header: 'Data', width: 18, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'Mesa/Balcão', width: 12 }, { header: 'Produto', width: 36 }, { header: 'Qtd', width: 8 }, { header: 'Unitário', width: 14, fmt: BRL }, { header: 'Subtotal', width: 14, fmt: BRL }]);
  let linhaItem = 2;
  d.vendas.forEach((o) => (o.order_items ?? []).filter((i) => i.status !== ('canceled' as any)).forEach((i) => {
    it.addRow([horaBahia(o.created_at), o.order_type === 'counter' ? 'Balcão' : `Mesa ${(o as any).tables?.number ?? ''}`, safeCell(i.product?.name ?? 'Produto'), i.quantity, Number(i.price_at_time), { formula: `D${linhaItem}*E${linhaItem}`, result: i.quantity * Number(i.price_at_time) }]);
    linhaItem += 1;
  }));
  if (linhaItem > 2) it.autoFilter = { from: 'A1', to: `F${linhaItem - 1}` };

  // 7. Exceções
  if (d.excecoes.length > 0) {
  const ex = wb.addWorksheet('Exceções');
  headerRow(ex, [{ header: 'Data', width: 18, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'Operador', width: 20 }, { header: 'Tipo', width: 24 }, { header: 'Produto/Detalhe', width: 30 }, { header: 'Valor', width: 14, fmt: BRL }, { header: 'Motivo', width: 30 }]);
  d.excecoes.forEach((e) => {
    const det = e.details as Record<string, unknown>;
    ex.addRow([horaBahia(e.created_at), safeCell(e.operator_name), EXCEPTION_LABELS[e.event_type] ?? e.event_type, safeCell(String(det.produto ?? '')), Number(det.valor ?? 0), safeCell(String(det.motivo ?? ''))]);
  });
  }

  // Rodapé de impressão
  wb.worksheets.forEach((w) => {
    w.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
    w.headerFooter = { oddHeader: `&L&B${d.loja}&R${d.periodoLabel}`, oddFooter: `&LNorte Vendas&RPágina &P de &N` };
  });
  // Fonte única (Calibri) em todas as abas.
  wb.worksheets.forEach((ws) => ws.eachRow({ includeEmpty: true }, (row) => row.eachCell({ includeEmpty: true }, (c) => { c.font = { name: FONT, size: 11, ...(c.font ?? {}) }; })));
  return wb;
}

const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

function montarPainelSheet(wb: Workbook, d: FechamentoData, p: PainelDia) {
  const ws = wb.addWorksheet('Painel', { views: [{ showGridLines: false }] });
  ws.properties.tabColor = { argb: HEAD_DARK };
  // 4 cartões de 40 de largura (A+B, C+D, E+F, G+H); as tabelas usam A=rótulo B=total C=contas D=ticket E:H=participação.
  ws.columns = [{ width: 26 }, { width: 14 }, { width: 14 }, { width: 26 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }];

  // Faixa de título
  ws.mergeCells('A1:H1');
  const t = ws.getCell('A1');
  t.value = `NORTE VENDAS  ·  ${d.titulo ?? 'Relatório do dia'}`;
  t.font = { bold: true, size: 11, color: { argb: 'FFDCDEF8' } };
  t.fill = fill(HEAD_DARK);
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 22;
  ws.mergeCells('A2:H2');
  const n = ws.getCell('A2');
  n.value = d.loja;
  n.font = { bold: true, size: 20, color: { argb: 'FFFFFFFF' } };
  n.fill = fill(HEAD_FILL);
  n.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 36;
  ws.mergeCells('A3:H3');
  const per = ws.getCell('A3');
  per.value = `${d.periodoLabel}  ·  gerado em ${d.geradoEm.toLocaleString('pt-BR')} por ${d.geradoPor}`;
  per.font = { size: 10, color: { argb: 'FFDCDEF8' } };
  per.fill = fill(HEAD_FILL);
  per.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(3).height = 20;
  ws.addRow([]);

  // Cartões de indicadores (4 por linha, 2 colunas cada)
  const cards: [string, number, string?][][] = [
    [['Total recebido', p.kpis.recebido, BRL], ['Contas pagas', p.kpis.contas], ['Ticket médio', p.kpis.ticket ?? 0, BRL], ['Itens vendidos', p.kpis.itens]],
    [['Cartão de crédito', p.kpis.credito, BRL], ['Cartão de débito', p.kpis.debito, BRL], ['Taxa de serviço', p.kpis.taxa, BRL], [p.rotuloCancelamentos ?? 'Cancelamentos', p.kpis.cancelamentos]],
  ];
  cards.forEach((linha) => {
    const rl = ws.addRow([]); const rv = ws.addRow([]);
    rl.height = 18; rv.height = 30;
    linha.forEach(([label, valor, fmt], i) => {
      const c1 = i * 2 + 1;
      ws.mergeCells(rl.number, c1, rl.number, c1 + 1);
      ws.mergeCells(rv.number, c1, rv.number, c1 + 1);
      const cl = rl.getCell(c1); const cv = rv.getCell(c1);
      cl.value = label; cl.font = { size: 9, bold: true, color: { argb: 'FF666A75' } }; cl.fill = fill(SOFT_FILL); cl.alignment = { indent: 1, vertical: 'bottom' };
      cv.value = valor; cv.font = { size: 18, bold: true, color: { argb: HEAD_DARK } }; cv.fill = fill(SOFT_FILL); cv.alignment = { indent: 1, vertical: 'middle', horizontal: 'left' };
      if (fmt) cv.numFmt = fmt;
      rl.getCell(c1 + 1).fill = fill(SOFT_FILL); rv.getCell(c1 + 1).fill = fill(SOFT_FILL);
    });
    ws.addRow([]);
  });

  const COLS = 8;
  interface Linha { rotulo: string; total: number; contas?: number | null; ticket?: number | null; pct: number }
  const banda = (titulo: string) => {
    const r = ws.addRow([titulo]);
    ws.mergeCells(r.number, 1, r.number, COLS);
    const c = r.getCell(1);
    c.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    c.fill = fill(HEAD_FILL);
    c.alignment = { vertical: 'middle', indent: 1 };
    r.height = 22;
  };
  const cabecalho = (cols: [string, string, string, string, string]) => {
    const r = ws.addRow(cols);
    ws.mergeCells(r.number, 5, r.number, COLS);
    for (let c = 1; c <= COLS; c += 1) r.getCell(c).fill = fill(SOFT_FILL);
    r.font = { bold: true, size: 9, color: { argb: HEAD_DARK } };
    [2, 3, 4].forEach((c) => { r.getCell(c).alignment = { horizontal: 'right' }; });
    r.getCell(1).alignment = { indent: 1 };
    r.getCell(5).alignment = { indent: 1 };
  };
  const bloco = (titulo: string, cols: [string, string, string, string, string], linhas: Linha[], total?: { rotulo: string; valor: number }) => {
    banda(titulo);
    cabecalho(cols);
    const de = ws.rowCount + 1;
    linhas.forEach((l) => {
      const r = ws.addRow([l.rotulo, l.total, l.contas ?? null, l.ticket ?? null, l.pct]);
      ws.mergeCells(r.number, 5, r.number, COLS);
      r.getCell(1).alignment = { indent: 1 };
      r.getCell(2).numFmt = BRL; r.getCell(3).numFmt = '0'; r.getCell(4).numFmt = BRL;
      r.getCell(5).numFmt = '0.0%'; r.getCell(5).alignment = { horizontal: 'left', indent: 1 };
    });
    const ate = ws.rowCount;
    if (linhas.length > 0) {
      ws.addConditionalFormatting({ ref: `E${de}:E${ate}`, rules: [{ type: 'dataBar', priority: 1, gradient: false, border: false, minLength: 0, maxLength: 100, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: BAR } } as any] });
    }
    if (total) {
      const r = ws.addRow([total.rotulo, total.valor]);
      ws.mergeCells(r.number, 3, r.number, COLS);
      r.font = { bold: true };
      r.getCell(1).alignment = { indent: 1 };
      r.getCell(2).numFmt = BRL;
      for (let c = 1; c <= COLS; c += 1) r.getCell(c).border = { top: { style: 'thin', color: { argb: HEAD_FILL } } };
    }
    ws.addRow([]);
  };
  const soma = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const pct = (parte: number, todo: number) => (todo > 0 ? parte / todo : 0);
  const totalHora = soma(p.porHora.map((r) => r.total));
  const totalOper = soma(p.porOperador.map((r) => r.total));
  const totalCat = soma(p.porCategoria.map((r) => r.total));
  const totalProd = soma(p.topProdutos.map((r) => r.total));

  bloco('Formas de pagamento', ['Forma', 'Total', '', '', 'Participação'], p.formas.map((f) => ({ rotulo: f.label, total: f.total, pct: pct(f.total, p.kpis.recebido) })), { rotulo: 'TOTAL', valor: soma(p.formas.map((f) => f.total)) });
  bloco('Cartões por bandeira (crédito e débito separados)', ['Bandeira', 'Total', '', '', 'Participação'], p.cartoes.map((c) => ({ rotulo: c.label, total: c.total, pct: pct(c.total, p.kpis.recebido) })), { rotulo: 'TOTAL EM CARTÕES', valor: soma(p.cartoes.map((c) => c.total)) });
  bloco('Vendas por hora', ['Hora', 'Total', 'Contas', 'Ticket médio', 'Participação'], p.porHora.map((r) => ({ rotulo: r.label, total: r.total, contas: r.orders, ticket: r.ticket, pct: pct(r.total, totalHora) })));
  bloco('Vendas por operador', ['Operador', 'Total', 'Contas', 'Ticket médio', 'Participação'], p.porOperador.map((r) => ({ rotulo: safeCell(r.label), total: r.total, contas: r.orders, ticket: r.ticket, pct: pct(r.total, totalOper) })));
  bloco('Vendas por categoria', ['Categoria', 'Total', '', '', 'Participação'], p.porCategoria.map((r) => ({ rotulo: safeCell(r.label), total: r.total, pct: pct(r.total, totalCat) })));
  bloco('Produtos mais vendidos', ['Produto', 'Total', 'Qtd', '', 'Participação'], p.topProdutos.map((r) => ({ rotulo: safeCell(r.nome), total: r.total, contas: r.qtd, pct: pct(r.total, totalProd) })));
  if (p.porHora.length === 0) { const r = ws.addRow(['Nenhuma venda neste período.']); ws.mergeCells(r.number, 1, r.number, COLS); r.getCell(1).font = { italic: true, color: { argb: 'FF666A75' } }; r.getCell(1).alignment = { indent: 1 }; ws.addRow([]); }

  const nl = ws.rowCount + 1;
  ws.mergeCells(`A${nl}:H${nl}`);
  const rod = ws.getCell(`A${nl}`);
  rod.value = NORTE_RODAPE;
  rod.font = { size: 8, italic: true, color: { argb: 'FF8A8EA0' } };
  rod.alignment = { horizontal: 'center' };
}
