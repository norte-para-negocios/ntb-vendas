// rodar com: npx tsx scripts/testes/fechamentoXlsx.test.ts
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildFechamentoWorkbook, fechamentoFileName, safeCell, type FechamentoData } from '../../lib/reports/fechamentoXlsx';

assert.equal(fechamentoFileName('sertao', '2026-10-03'), 'fechamento_2026-10-03_sertao.xlsx');
assert.equal(safeCell('=1+1'), "'=1+1");
assert.equal(safeCell('+55'), "'+55");
assert.equal(safeCell('@x'), "'@x");
assert.equal(safeCell('Maria'), 'Maria');

const resumo: any = {
  shift: {}, totals_by_method: { PIX: 100, CASH: 50, DEBIT: 0, CREDIT: 200 }, totals_by_brand: {},
  totals_by_card: { 'CREDIT|visa': 200 }, total_sangria: 10, total_suprimento: 0, expected_cash: 40,
  payments_count: 4, payments_total: 350, closing_counted_cash: 40, difference: 0,
};
const base: FechamentoData = {
  loja: 'O Sertão Vai Virar Mar', periodoLabel: '03/10/2026', geradoEm: new Date('2026-10-04T01:00:00Z'), geradoPor: 'Claudia',
  turnos: [{ operador: 'Claudia', abertoEm: '2026-10-03T16:00:00Z', fechadoEm: '2026-10-04T02:00:00Z', fundo: 0, contado: 40, resumo }],
  vendas: [
    { id: '1', status: 'delivered', order_type: 'table', total: 100, created_at: '2026-10-03T22:00:00Z', tables: { number: 8 }, customer_name: '=HYPERLINK("x")',
      payment_details: { operador_nome: 'Claudia', total: 110, methods: [{ method: 'CREDIT', brand: 'visa', amount: 110 }] },
      order_items: [{ quantity: 2, price_at_time: 50, status: 'delivered', product: { name: 'Moqueca', category_id: null } }] },
  ] as any,
  excecoes: [{ operator_name: 'Claudia', event_type: 'item_cancelado', created_at: '2026-10-03T23:00:00Z', details: { produto: 'Água', valor: 5, motivo: 'Erro de lançamento' } }],
};

(async () => {
  const wb = await buildFechamentoWorkbook(base);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumo', 'Formas de pagamento', 'Cartões', 'Caixa', 'Vendas', 'Itens', 'Exceções']);

  // round-trip: grava e relê pra garantir que o arquivo abre
  const buf = await wb.xlsx.writeBuffer();
  const rt = new ExcelJS.Workbook();
  await rt.xlsx.load(buf as ArrayBuffer);
  const formas = rt.getWorksheet('Formas de pagamento')!;
  assert.equal(formas.getRow(1).getCell(1).value, 'Forma');
  assert.equal(formas.getRow(2).getCell(1).value, 'Dinheiro'); // sempre os 4 meios, mesmo zerado
  assert.equal(formas.getRow(2).getCell(2).value, 50);
  assert.equal(formas.getRow(3).getCell(2).value, 100);
  assert.equal(formas.getRow(4).getCell(2).value, 0);          // débito zerado aparece
  const total = formas.getRow(6).getCell(2).value as any;
  assert.ok(total && typeof total === 'object' && /SUM/.test(String(total.formula)), 'total é fórmula SUM');
  assert.equal(formas.getRow(2).getCell(2).numFmt, '"R$" #,##0.00');

  const cartoes = rt.getWorksheet('Cartões')!;
  assert.equal(cartoes.getRow(2).getCell(1).value, 'Mastercard crédito'); // ordem da folha
  assert.ok(cartoes.rowCount >= 13, '12 linhas fixas + total');

  const res = rt.getWorksheet('Resumo')!;
  const labels = res.getColumn(1).values as any[];
  assert.ok(labels.some((v) => v === 'Ticket médio'), 'resumo tem ticket médio');

  // Review Focus 4: nome de cliente com '=' não vira fórmula
  const vendas = rt.getWorksheet('Vendas')!;
  const cliente = vendas.getRow(2).values as any[];
  assert.ok(cliente.some((v) => v === `'=HYPERLINK("x")`), 'cliente neutralizado');

  // Review Focus 1: dia vazio abre sem erro, com cabeçalhos
  const vazio = await buildFechamentoWorkbook({ ...base, turnos: [], vendas: [], excecoes: [] });
  const vbuf = await vazio.xlsx.writeBuffer();
  const vrt = new ExcelJS.Workbook();
  await vrt.xlsx.load(vbuf as ArrayBuffer);
  assert.equal(vrt.getWorksheet('Vendas')!.getRow(1).getCell(1).value, 'Data');
  assert.equal(vrt.getWorksheet('Caixa')!.getRow(1).getCell(1).value, 'Operador');

  // Review Focus 3: mesma conta (mesa) com 2 pedidos e o MESMO pagamento: recebido só uma vez
  const dupla: FechamentoData = { ...base, vendas: [
    { id: 'p1', table_id: 't1', status: 'delivered', order_type: 'table', total: 442.8, created_at: '2026-10-03T22:00:00Z', tables: { number: 22 }, order_items: [],
      payment_details: { operador_nome: 'Claudia', methods: [{ method: 'CREDIT', brand: 'visa', amount: 487.08 }] } },
    { id: 'p2', table_id: 't1', status: 'delivered', order_type: 'table', total: 44.28, created_at: '2026-10-03T22:00:01Z', tables: { number: 22 }, order_items: [],
      payment_details: { operador_nome: 'Claudia', methods: [{ method: 'CREDIT', brand: 'visa', amount: 487.08 }] } },
  ] as any };
  const wd = await buildFechamentoWorkbook(dupla);
  const rb = new ExcelJS.Workbook();
  await rb.xlsx.load((await wd.xlsx.writeBuffer()) as ArrayBuffer);
  const v = rb.getWorksheet('Vendas')!;
  assert.equal(Number(v.getRow(2).getCell(8).value) + Number(v.getRow(3).getCell(8).value), 487.08, 'recebido da conta aparece uma vez');
  console.log('fechamentoXlsx: ok');
})();
