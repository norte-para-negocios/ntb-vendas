// lib/reports/fechamentoXlsx.ts
import type { Workbook, Worksheet } from 'exceljs';
import type { Order } from '@/types';
import type { CashShiftSummary } from '../api';
import type { ExceptionEvent } from '../excecoes';
import { completarFormas, completarCartoes, ticketMedio } from '../caixaResumo';
import { getPaymentMethodLabel, getCardTotalLabel } from '../labels';

export interface FechamentoTurno { operador: string; abertoEm: string; fechadoEm: string | null; fundo: number; contado: number | null; resumo: CashShiftSummary }
export interface FechamentoData { loja: string; periodoLabel: string; geradoEm: Date; geradoPor: string; turnos: FechamentoTurno[]; vendas: Order[]; excecoes: ExceptionEvent[] }

const BRL = '"R$" #,##0.00';
const HEAD_FILL = 'FF2B2E83';

export const fechamentoFileName = (lojaSlug: string, dia: string): string => `fechamento_${dia}_${lojaSlug}.xlsx`;

// Texto que começa com = + - @ viraria fórmula no Excel (injeção de planilha).
export const safeCell = (v: string): string => (/^[=+\-@]/.test(v) ? `'${v}` : v);

function headerRow(ws: Worksheet, cols: { header: string; width: number; fmt?: string }[]) {
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
  const r = ws.getRow(1);
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
  r.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function buildFechamentoWorkbook(d: FechamentoData): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = d.geradoPor;
  wb.created = d.geradoEm;

  // Totais do período (soma dos turnos, já deduplicados pelo servidor)
  const formasTot: Record<string, number> = {};
  const cartoesTot: Record<string, number> = {};
  let contas = 0, recebido = 0, sangria = 0, suprimento = 0, taxa = 0;
  d.turnos.forEach((t) => {
    Object.entries(t.resumo.totals_by_method ?? {}).forEach(([k, v]) => { formasTot[k] = (formasTot[k] ?? 0) + Number(v); });
    Object.entries(t.resumo.totals_by_card ?? {}).forEach(([k, v]) => { cartoesTot[k] = (cartoesTot[k] ?? 0) + Number(v); });
    contas += Number(t.resumo.payments_count ?? 0);
    recebido += Number(t.resumo.payments_total ?? 0);
    sangria += Number(t.resumo.total_sangria ?? 0);
    suprimento += Number(t.resumo.total_suprimento ?? 0);
    taxa += Number(t.resumo.service_fee_total ?? 0);
  });

  // 1. Resumo
  const res = wb.addWorksheet('Resumo');
  res.columns = [{ width: 34 }, { width: 22 }];
  res.addRow([d.loja]).font = { bold: true, size: 14 };
  res.addRow(['Período', d.periodoLabel]);
  res.addRow([]);
  const kpis: [string, number | string, string?][] = [
    ['Contas pagas', contas],
    ['Total recebido', recebido, BRL],
    ['Ticket médio', ticketMedio(recebido, contas) ?? 0, BRL],
    ['Taxa de serviço', taxa, BRL],
    ['Sangrias', sangria, BRL],
    ['Suprimentos', suprimento, BRL],
    ['Itens cancelados / exceções', d.excecoes.length],
  ];
  kpis.forEach(([l, v, fmt]) => { const r = res.addRow([l, v]); r.getCell(1).font = { bold: true }; if (fmt) r.getCell(2).numFmt = fmt; });
  res.addRow([]);
  res.addRow([`Gerado em ${d.geradoEm.toLocaleString('pt-BR')} por ${d.geradoPor}`]).font = { italic: true, color: { argb: 'FF666A75' } };

  // 2. Formas de pagamento (sempre os 4 meios) com total em fórmula
  const fp = wb.addWorksheet('Formas de pagamento');
  headerRow(fp, [{ header: 'Forma', width: 24 }, { header: 'Total', width: 18, fmt: BRL }]);
  const formas = completarFormas(formasTot);
  formas.forEach((f) => fp.addRow([f.label, f.total]));
  const ultimaForma = formas.length + 1;
  const totRow = fp.addRow(['TOTAL', { formula: `SUM(B2:B${ultimaForma})`, result: formas.reduce((s, f) => s + f.total, 0) }]);
  totRow.font = { bold: true };
  totRow.getCell(2).numFmt = BRL;
  fp.autoFilter = undefined as any;

  // 3. Cartões (ordem da folha de papel)
  const ca = wb.addWorksheet('Cartões');
  headerRow(ca, [{ header: 'Bandeira', width: 30 }, { header: 'Total', width: 18, fmt: BRL }]);
  const cartoes = completarCartoes(cartoesTot);
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
    const r = cx.addRow([safeCell(t.operador), new Date(t.abertoEm), t.fechadoEm ? new Date(t.fechadoEm) : null, t.fundo, t.resumo.expected_cash, t.contado, null]);
    if (t.contado != null) r.getCell(7).value = { formula: `F${i + 2}-E${i + 2}`, result: t.contado - t.resumo.expected_cash };
  });

  // 5. Vendas (um pedido por linha; o recebido da conta fica na linha do 1º pedido pra não somar em dobro)
  const vd = wb.addWorksheet('Vendas');
  headerRow(vd, [
    { header: 'Data', width: 18, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'Mesa/Balcão', width: 12 }, { header: 'Cliente', width: 24 }, { header: 'Operador', width: 18 },
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
      new Date(o.created_at), o.order_type === 'counter' ? 'Balcão' : `Mesa ${(o as any).tables?.number ?? ''}`, safeCell(o.customer_name ?? ''), safeCell(pd.operador_nome ?? ''),
      methods.map((m) => getPaymentMethodLabel(m.method)).join(' + '), methods.map((m) => m.brand ?? '').filter(Boolean).join(' + '),
      Number(o.total), recebidoConta, o.status === 'canceled' ? 'Cancelada' : 'Entregue',
    ]);
  });
  if (d.vendas.length > 0) vd.autoFilter = { from: 'A1', to: `I${d.vendas.length + 1}` };

  // 6. Itens
  const it = wb.addWorksheet('Itens');
  headerRow(it, [{ header: 'Data', width: 18, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'Mesa/Balcão', width: 12 }, { header: 'Produto', width: 36 }, { header: 'Qtd', width: 8 }, { header: 'Unitário', width: 14, fmt: BRL }, { header: 'Subtotal', width: 14, fmt: BRL }]);
  let linhaItem = 2;
  d.vendas.forEach((o) => (o.order_items ?? []).filter((i) => i.status !== ('canceled' as any)).forEach((i) => {
    it.addRow([new Date(o.created_at), o.order_type === 'counter' ? 'Balcão' : `Mesa ${(o as any).tables?.number ?? ''}`, safeCell(i.product?.name ?? 'Produto'), i.quantity, Number(i.price_at_time), { formula: `D${linhaItem}*E${linhaItem}`, result: i.quantity * Number(i.price_at_time) }]);
    linhaItem += 1;
  }));
  if (linhaItem > 2) it.autoFilter = { from: 'A1', to: `F${linhaItem - 1}` };

  // 7. Exceções
  const ex = wb.addWorksheet('Exceções');
  headerRow(ex, [{ header: 'Data', width: 18, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'Operador', width: 20 }, { header: 'Tipo', width: 24 }, { header: 'Produto/Detalhe', width: 30 }, { header: 'Valor', width: 14, fmt: BRL }, { header: 'Motivo', width: 30 }]);
  d.excecoes.forEach((e) => {
    const det = e.details as Record<string, unknown>;
    ex.addRow([new Date(e.created_at), safeCell(e.operator_name), e.event_type, safeCell(String(det.produto ?? '')), Number(det.valor ?? 0), safeCell(String(det.motivo ?? ''))]);
  });

  // Rodapé de impressão
  wb.worksheets.forEach((w) => { w.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }; });
  void getCardTotalLabel; // (mantido: rótulos de cartão vêm de completarCartoes)
  return wb;
}
