// rodar com: npx tsx scripts/testes/fechamentoXlsx.test.ts
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { montarPainel } from '../../lib/reports/painelDia';
import { buildFechamentoWorkbook, fechamentoFileName, safeCell, horaBahia, NORTE_RODAPE, type FechamentoData } from '../../lib/reports/fechamentoXlsx';

assert.equal(fechamentoFileName('sertao', '2026-10-03'), 'fechamento_2026-10-03_sertao.xlsx');
assert.equal(safeCell('=1+1'), "'=1+1");
assert.equal(safeCell('+55'), "'+55");
assert.equal(safeCell('@x'), "'@x");
assert.equal(safeCell('Maria'), 'Maria');

const resumo: any = { totals_by_method: { CASH: 100, CREDIT: 300, DEBIT: 50, PIX: 20 }, totals_by_card: { 'CREDIT|visa': 200, 'CREDIT|elo': 100, 'DEBIT|visa': 50 }, payments_count: 5, payments_total: 470, total_sangria: 20, total_suprimento: 0, service_fee_total: 45, expected_cash: 100 };
const it = (n: string, q: number, p: number, cat: string | null = 'c1') => ({ id: n, quantity: q, price_at_time: p, status: 'delivered', product: { name: n, category_id: cat } });
const v = (id: string, h: string, itens: any[], op = 'ANE'): any => ({ id, table_id: id, status: 'delivered', created_at: h, order_type: 'table', total: 100, tables: { number: Number(id) },
  payment_details: { operador_nome: op, methods: [{ method: 'CREDIT', brand: 'visa', amount: 100 }] }, order_items: itens });

const base = { loja: 'Loja <Teste> & "Cia"', periodoLabel: '04/10/2026', geradoEm: new Date('2026-10-05T01:00:00Z'), geradoPor: 'QA', excecoes: [] as any[],
  nomeCategoria: (id: string) => (id === 'c1' ? 'Pizzas' : undefined) };

async function ler(wb: ExcelJS.Workbook) { const r = new ExcelJS.Workbook(); await r.xlsx.load(await wb.xlsx.writeBuffer() as any); return r; }
const textos = (ws: ExcelJS.Worksheet) => { const out: string[] = []; ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'string') out.push(c.value); })); return out; };

(async () => {
  const wb = await buildFechamentoWorkbook({ ...base,
    turnos: [{ operador: '=CMD()', abertoEm: '2026-10-04T15:00:00Z', fechadoEm: '2026-10-05T02:00:00Z', fundo: 100, contado: 190, resumo }],
    vendas: [v('1', '2026-10-04T22:00:00Z', [it('Pizza', 1, 100), it('Sem cat', 1, 10, null)]), v('2', '2026-10-04T23:30:00Z', [it('Pizza', 2, 50)], '=SOMA(1)')] });
  const r = await ler(wb);
  assert.deepEqual(r.worksheets.map((w) => w.name), ['Painel', 'Formas de pagamento', 'Cartões', 'Caixa', 'Vendas', 'Itens'], 'Painel é a 1ª aba; sem aba Resumo; sem Exceções vazia');
  const painel = r.getWorksheet('Painel')!;
  const t = textos(painel);
  assert.ok(t.includes('Loja <Teste> & "Cia"'), 'nome da loja no título');
  assert.ok(t.includes('Total recebido') && t.includes('Ticket médio') && t.includes('Cartão de crédito') && t.includes('Cartão de débito'), 'cartões de KPI');
  assert.ok(t.includes('Hipercard crédito'), 'bandeira zerada continua listada (Review Focus 6)');
  assert.ok(t.includes('Pizzas'), 'categoria pelo nome, não pelo id (Review Focus 1)');
  assert.ok(t.includes('Sem categoria'), 'produto sem categoria');
  assert.ok(t.includes(NORTE_RODAPE), 'propaganda pequena do Norte');
  assert.ok(!t.some((s) => /^[=+\-@]/.test(s)), 'nenhum texto vira fórmula (Review Focus 3)');
  painel.eachRow((row) => row.eachCell((c) => { assert.equal(c.font?.name, 'Calibri', `fonte Calibri em ${c.address}`); }));
  assert.ok(painel.getCell('A2').fill && (painel.getCell('A2').fill as any).fgColor.argb === 'FF484DB5', 'faixa na cor da marca');

  // Abas de detalhe (herdado do teste anterior)
  const formas = r.getWorksheet('Formas de pagamento')!;
  assert.equal(formas.getRow(2).getCell(1).value, 'Dinheiro'); // sempre os 4 meios, mesmo zerado
  assert.equal(formas.getRow(2).getCell(2).value, 100);
  assert.equal(formas.getRow(2).getCell(2).numFmt, '"R$" #,##0.00');
  const total = formas.getRow(6).getCell(2).value as any;
  assert.ok(total && typeof total === 'object' && /SUM/.test(String(total.formula)), 'total é fórmula SUM');
  const cartoes = r.getWorksheet('Cartões')!;
  assert.equal(cartoes.getRow(2).getCell(1).value, 'Mastercard crédito'); // ordem da folha
  assert.ok(cartoes.rowCount >= 13, '12 linhas fixas + total');
  const vendas = r.getWorksheet('Vendas')!;
  assert.equal((vendas.getRow(2).getCell(1).value as Date).getUTCHours(), 19, 'data da venda no relógio de Bahia (22h UTC = 19h)');
  assert.equal(horaBahia('2026-10-03T22:00:00Z').getUTCHours(), 19);
  assert.equal(vendas.getRow(2).getCell(6).value, 'Visa', 'bandeira com rótulo, não o código');
  assert.ok((vendas.getRow(3).values as any[]).every((x) => typeof x !== 'string' || !/^[=+\-@]/.test(x)), 'operador neutralizado nas vendas');

  // Mesma conta (mesa) com 2 pedidos e o MESMO pagamento: recebido só uma vez
  const dupla: FechamentoData = { ...base, turnos: [], excecoes: [], vendas: [
    { id: 'p1', table_id: 't1', status: 'delivered', order_type: 'table', total: 442.8, created_at: '2026-10-03T22:00:00Z', tables: { number: 22 }, order_items: [],
      payment_details: { operador_nome: 'Claudia', methods: [{ method: 'CREDIT', brand: 'visa', amount: 487.08 }] } },
    { id: 'p2', table_id: 't1', status: 'delivered', order_type: 'table', total: 44.28, created_at: '2026-10-03T22:00:01Z', tables: { number: 22 }, order_items: [],
      payment_details: { operador_nome: 'Claudia', methods: [{ method: 'CREDIT', brand: 'visa', amount: 487.08 }] } },
  ] as any };
  const rb = await ler(await buildFechamentoWorkbook(dupla));
  const vd = rb.getWorksheet('Vendas')!;
  assert.equal(Number(vd.getRow(2).getCell(9).value) + Number(vd.getRow(3).getCell(9).value), 487.08, 'recebido da conta aparece uma vez');

  // Item CANCELADO não entra no total (achado do portão 04/10: 131,60 contra 111,70 dos itens e 122,87 recebidos).
  // orders.total do banco NÃO desconta o item cancelado; o Excel recalcula pelos itens ativos.
  const item = (id: string, q: number, p: number, status = 'delivered') => ({ id, quantity: q, price_at_time: p, status, product: { name: id } });
  const cancelada: FechamentoData = { ...base, turnos: [], excecoes: [], vendas: [
    { id: 'c1', table_id: 'tc', status: 'delivered', order_type: 'table', total: 131.6, created_at: '2026-10-04T22:00:00Z', tables: { number: 12 },
      payment_details: { total: 122.87, operador_nome: 'Ana', methods: [{ method: 'CREDIT', brand: 'visa', amount: 122.87 }] },
      order_items: [item('Pizza', 1, 60), item('Suco', 2, 15.85), item('Burger', 1, 20), item('Extra', 1, 19.9, 'canceled')] },
  ] as any };
  const rc = await ler(await buildFechamentoWorkbook(cancelada));
  const vc = rc.getWorksheet('Vendas')!;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => vc.getRow(1).getCell(c).value).slice(6), ['Total dos itens', 'Taxa de serviço', 'Recebido da conta', 'Status'], 'cabeçalho deixa claro itens, taxa e recebido');
  assert.equal(Number(vc.getRow(2).getCell(7).value), 111.7, 'Total dos itens = só itens ativos (60 + 31,70 + 20), sem o cancelado');
  assert.equal(Number(vc.getRow(2).getCell(8).value), 11.17, 'taxa = recebido - itens ativos');
  assert.equal(Number(vc.getRow(2).getCell(9).value), 122.87, 'recebido da conta');
  const ic = rc.getWorksheet('Itens')!;
  let somaItens = 0; ic.eachRow((row, n) => { if (n > 1) somaItens += Number((row.getCell(6).value as any)?.result ?? row.getCell(6).value); });
  assert.equal(Math.round(somaItens * 100) / 100, 111.7, 'aba Itens soma o mesmo total e não lista o cancelado');

  // Exceções só existe com dados
  const comExc = await ler(await buildFechamentoWorkbook({ ...base, turnos: [], vendas: [], excecoes: [{ operator_name: 'Claudia', event_type: 'item_cancelado', created_at: '2026-10-03T23:00:00Z', details: { produto: 'Água', valor: 5, motivo: 'Erro' } }] }));
  assert.ok(comExc.getWorksheet('Exceções'), 'aba Exceções com dados');

  // painel pronto (Histórico de vendas) substitui o cálculo por turnos
  const pronto = montarPainel({ ...base, turnos: [], vendas: [], excecoes: [] });
  pronto.kpis.recebido = 777;
  const comPainel = await ler(await buildFechamentoWorkbook({ ...base, turnos: [], vendas: [], excecoes: [], painel: pronto }));
  assert.equal(comPainel.getWorksheet('Painel')!.getCell('A5').value, 'Total recebido');
  assert.equal(comPainel.getWorksheet('Painel')!.getCell('A6').value, 777, 'usa o painel recebido');

  // Dia vazio (Review Focus 2)
  const vazio = await ler(await buildFechamentoWorkbook({ ...base, turnos: [], vendas: [] }));
  assert.deepEqual(vazio.worksheets.map((w) => w.name), ['Painel', 'Formas de pagamento', 'Cartões', 'Vendas', 'Itens']);
  vazio.getWorksheet('Painel')!.eachRow((row) => row.eachCell((c) => { assert.ok(!(typeof c.value === 'number' && Number.isNaN(c.value)), 'sem NaN'); }));
  assert.ok(textos(vazio.getWorksheet('Painel')!).includes('Nenhuma venda neste período.'), 'mensagem de dia vazio');
  assert.equal(vazio.getWorksheet('Vendas')!.getRow(1).getCell(1).value, 'Data');
  console.log('fechamentoXlsx: ok');
})();
