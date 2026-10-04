// lib/reports/fechamentoXlsx.ts
import type { Workbook, Worksheet } from 'exceljs';
import type { Order } from '@/types';
import type { CashShiftSummary } from '../api';
import type { ExceptionEvent } from '../excecoes';
import { montarPainel, type PainelDia } from './painelDia';
import { getPaymentMethodLabel, getCardBrandLabel } from '../labels';

export interface FechamentoTurno { operador: string; abertoEm: string; fechadoEm: string | null; fundo: number; contado: number | null; resumo: CashShiftSummary }
export interface FechamentoData { nomeCategoria?: (id: string) => string | undefined; loja: string; periodoLabel: string; geradoEm: Date; geradoPor: string; turnos: FechamentoTurno[]; vendas: Order[]; excecoes: ExceptionEvent[] }

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
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
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

  const painel = montarPainel(d, d.nomeCategoria);
  const { kpis } = painel;
  const { recebido, sangria, suprimento } = { recebido: kpis.recebido, sangria: kpis.sangria, suprimento: kpis.suprimento };
  void recebido; void sangria; void suprimento;
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
  const cx = wb.addWorksheet('Caixa');
  headerRow(cx, [
    { header: 'Operador', width: 22 }, { header: 'Abertura', width: 18, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'Fechamento', width: 18, fmt: 'dd/mm/yyyy hh:mm' },
    { header: 'Fundo', width: 14, fmt: BRL }, { header: 'Esperado em dinheiro', width: 20, fmt: BRL }, { header: 'Contado', width: 14, fmt: BRL }, { header: 'Diferença', width: 14, fmt: BRL },
  ]);
  d.turnos.forEach((t, i) => {
    const r = cx.addRow([safeCell(t.operador), horaBahia(t.abertoEm), t.fechadoEm ? horaBahia(t.fechadoEm) : null, t.fundo, t.resumo.expected_cash, t.contado, null]);
    if (t.contado != null) r.getCell(7).value = { formula: `F${i + 2}-E${i + 2}`, result: t.contado - t.resumo.expected_cash };
  });

  // 5. Vendas (um pedido por linha; o recebido da conta fica na linha do 1º pedido pra não somar em dobro)
  const vd = wb.addWorksheet('Vendas');
  headerRow(vd, [
    { header: 'Data', width: 18, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'Mesa/Balcão', width: 12 }, { header: 'Cliente / lançado por', width: 24 }, { header: 'Operador', width: 18 },
    { header: 'Forma', width: 20 }, { header: 'Bandeira', width: 14 }, { header: 'Total do pedido', width: 16, fmt: BRL }, { header: 'Recebido da conta', width: 18, fmt: BRL }, { header: 'Status', width: 12 },
  ]);
  const contasVistas = new Set<string>();
  d.vendas.forEach((o) => {
    const pd = (o.payment_details ?? {}) as { operador_nome?: string; methods?: { method: string; brand?: string; amount: number }[] };
    const methods = Array.isArray(pd.methods) ? pd.methods : [];
    const chave = `${(o as any).table_id ?? o.id}|${JSON.stringify(pd.methods ?? [])}`;
    const recebidoConta = !contasVistas.has(chave) ? methods.reduce((s, m) => s + Number(m.amount), 0) : 0;
    contasVistas.add(chave);
    vd.addRow([
      horaBahia(o.created_at), o.order_type === 'counter' ? 'Balcão' : `Mesa ${(o as any).tables?.number ?? ''}`, safeCell(o.customer_name ?? ''), safeCell(pd.operador_nome ?? ''),
      methods.map((m) => getPaymentMethodLabel(m.method)).join(' + '), methods.map((m) => (m.brand ? getCardBrandLabel(m.brand) : '')).filter(Boolean).join(' + '),
      Number(o.total), recebidoConta, o.status === 'canceled' ? 'Cancelada' : 'Entregue',
    ]);
  });
  if (d.vendas.length > 0) vd.autoFilter = { from: 'A1', to: `I${d.vendas.length + 1}` };

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
  const ex = wb.addWorksheet('Exceções');
  headerRow(ex, [{ header: 'Data', width: 18, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'Operador', width: 20 }, { header: 'Tipo', width: 24 }, { header: 'Produto/Detalhe', width: 30 }, { header: 'Valor', width: 14, fmt: BRL }, { header: 'Motivo', width: 30 }]);
  d.excecoes.forEach((e) => {
    const det = e.details as Record<string, unknown>;
    ex.addRow([horaBahia(e.created_at), safeCell(e.operator_name), e.event_type, safeCell(String(det.produto ?? '')), Number(det.valor ?? 0), safeCell(String(det.motivo ?? ''))]);
  });

  // Rodapé de impressão
  wb.worksheets.forEach((w) => {
    w.pageSetup = { orientation: w.name === 'Painel' ? 'portrait' : 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
    w.headerFooter = { oddHeader: `&L&B${d.loja}&R${d.periodoLabel}`, oddFooter: `&L${NORTE_RODAPE}&RPágina &P de &N` };
  });
  return wb;
}

const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

function montarPainelSheet(wb: Workbook, d: FechamentoData, p: PainelDia) {
  const ws = wb.addWorksheet('Painel', { views: [{ showGridLines: false }] });
  ws.properties.tabColor = { argb: HEAD_DARK };
  ws.columns = [{ width: 30 }, { width: 18 }, { width: 12 }, { width: 16 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 18 }];

  // Faixa de título
  ws.mergeCells('A1:H1');
  const t = ws.getCell('A1');
  t.value = 'NORTE VENDAS  ·  Relatório do dia';
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
    [['Cartão de crédito', p.kpis.credito, BRL], ['Cartão de débito', p.kpis.debito, BRL], ['Taxa de serviço', p.kpis.taxa, BRL], ['Cancelamentos', p.kpis.cancelamentos]],
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

  const secao = (titulo: string, cols: string[]) => {
    const r = ws.addRow([titulo]);
    r.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    for (let c = 1; c <= 5; c += 1) r.getCell(c).fill = fill(HEAD_FILL);
    r.height = 22; r.alignment = { vertical: 'middle', indent: 1 };
    const h = ws.addRow(cols);
    h.font = { bold: true, size: 9, color: { argb: HEAD_DARK } };
    for (let c = 1; c <= 5; c += 1) { h.getCell(c).fill = fill(SOFT_FILL); if (c > 1) h.getCell(c).alignment = { horizontal: 'right' }; }
    return ws.rowCount;
  };
  const barras = (de: number, ate: number) => {
    if (ate < de) return;
    ws.addConditionalFormatting({ ref: `B${de}:B${ate}`, rules: [{ type: 'dataBar', priority: 1, gradient: false, border: false, minLength: 0, maxLength: 100, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: BAR } } as any] });
  };
  const bloco = (titulo: string, cols: string[], linhas: (string | number | null)[][], fmts: (string | undefined)[], totalLinha?: (string | number | null)[]) => {
    const h = secao(titulo, cols);
    linhas.forEach((l) => { const r = ws.addRow(l); fmts.forEach((f, i) => { if (f) r.getCell(i + 1).numFmt = f; }); r.getCell(1).alignment = { indent: 1 }; });
    if (totalLinha) { const r = ws.addRow(totalLinha); r.font = { bold: true }; r.getCell(1).alignment = { indent: 1 }; fmts.forEach((f, i) => { if (f) r.getCell(i + 1).numFmt = f; }); r.eachCell((c) => { c.border = { top: { style: 'thin', color: { argb: HEAD_FILL } } }; }); }
    barras(h + 1, h + linhas.length);
    ws.addRow([]);
  };
  const soma = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

  bloco('Formas de pagamento', ['Forma', 'Total', '', '', '% do total'], p.formas.map((f) => [f.label, f.total, null, null, p.kpis.recebido > 0 ? f.total / p.kpis.recebido : 0]), [undefined, BRL, undefined, undefined, '0.0%'], ['TOTAL', soma(p.formas.map((f) => f.total)), null, null, null]);
  bloco('Cartões por bandeira (crédito e débito separados)', ['Bandeira', 'Total', '', '', '% do total'], p.cartoes.map((c) => [c.label, c.total, null, null, p.kpis.recebido > 0 ? c.total / p.kpis.recebido : 0]), [undefined, BRL, undefined, undefined, '0.0%'], ['TOTAL EM CARTÕES', soma(p.cartoes.map((c) => c.total)), null, null, null]);
  bloco('Vendas por hora', ['Hora', 'Total', 'Contas', 'Ticket médio', '% do total'], p.porHora.map((r) => [r.label, r.total, r.orders, r.ticket, p.kpis.recebido > 0 ? r.total / p.kpis.recebido : 0]), [undefined, BRL, '0', BRL, '0.0%']);
  bloco('Vendas por operador', ['Operador', 'Total', 'Contas', 'Ticket médio', '% do total'], p.porOperador.map((r) => [safeCell(r.label), r.total, r.orders, r.ticket, p.kpis.recebido > 0 ? r.total / p.kpis.recebido : 0]), [undefined, BRL, '0', BRL, '0.0%']);
  bloco('Vendas por categoria', ['Categoria', 'Total', '', '', ''], p.porCategoria.map((r) => [safeCell(r.label), r.total, null, null, null]), [undefined, BRL]);
  bloco('Produtos mais vendidos', ['Produto', 'Total', 'Qtd', '', ''], p.topProdutos.map((r) => [safeCell(r.nome), r.total, r.qtd, null, null]), [undefined, BRL, '0']);

  ws.mergeCells(`A${ws.rowCount + 1}:H${ws.rowCount + 1}`);
  const rod = ws.getCell(`A${ws.rowCount}`);
  rod.value = NORTE_RODAPE;
  rod.font = { size: 8, italic: true, color: { argb: 'FF8A8EA0' } };
  rod.alignment = { horizontal: 'center' };

  // O painel é a primeira aba
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];
  const idx = wb.worksheets.indexOf(ws);
  if (idx > 0) { wb.worksheets.splice(idx, 1); wb.worksheets.unshift(ws); }
}
