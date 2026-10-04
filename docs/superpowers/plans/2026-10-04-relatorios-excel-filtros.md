# Relatórios, Excel de fechamento e filtros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Sertão uma área de Relatórios com Excel de fechamento formatado (várias abas) e filtros combináveis no histórico de vendas (operador, forma, bandeira, mesa, status, nota, hora).

**Architecture:** Duas bibliotecas puras e testáveis (`lib/reports/salesFilters.ts`, `lib/reports/fechamentoXlsx.ts`) que recebem dados já carregados (`Order[]`, `CashShiftSummary`) e não tocam rede nem DOM. A UI (`ReportsView`, filtros do histórico) só carrega dados pelas funções de `lib/api.ts` que já existem e chama as bibliotecas. O ExcelJS é importado dinamicamente no clique de "Baixar" pra não pesar o bundle.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, `exceljs` (novo), testes com `npx tsx scripts/testes/*.test.ts` + `node:assert/strict`.

**Spec:** `docs/plans/2026-10-04-proximas-features.md` e a pesquisa de filtros/relatórios de 04/10 (Excel multi-aba, filtros combináveis, nome de arquivo previsível `fechamento_AAAA-MM-DD_loja.xlsx`).

## Global Constraints

- Português do Brasil em toda a UI e nos rótulos de planilha.
- Valores monetários como **número** com formato `R$ #,##0.00` (nunca texto); datas como data real; totais com fórmula `SUM`, não valor colado.
- Dinheiro de turno vem de `CashShiftSummary` (`totals_by_method`, `totals_by_card`, `payments_count`, `payments_total`) já corrigido contra dupla contagem (migration 147). Não recalcular por pedido.
- Bandeiras e meios sempre na ordem de `lib/caixaResumo.ts` (`completarFormas`, `completarCartoes`).
- Nada de rede dentro de `lib/reports/*` (pureza, testável sem banco).
- Cada task termina com `npx tsc --noEmit` limpo, o teste da task passando e um commit.

## Review Focus

1. **Dia sem nenhuma venda ou turno:** o Excel precisa abrir com abas e cabeçalhos, totais 0, sem erro. Teste na Task 2.
2. **Pedido sem `payment_details` (venda aberta/cancelada):** filtros por forma/bandeira não podem quebrar nem contar o pedido como "Dinheiro". Teste na Task 1.
3. **Mesas com 2+ pedidos no mesmo pagamento:** a aba "Vendas" lista cada pedido, mas o total pago da conta não pode ser somado em dobro. Teste na Task 2.
4. **Texto com `=`, `+`, `-`, `@` no início (nome de cliente/produto):** não pode virar fórmula no Excel (injeção de planilha). Teste na Task 2.
5. **Período com fuso:** vendas às 23h30 BRT (02h30 UTC do dia seguinte) caem no dia certo do filtro por hora/dia. Teste na Task 1.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/reports/salesFilters.ts` (novo) | `SalesFilters`, `applySalesFilters`, `describeFilters` (chips), `EMPTY_FILTERS` |
| `lib/reports/fechamentoXlsx.ts` (novo) | `FechamentoData`, `buildFechamentoWorkbook`, `fechamentoFileName` |
| `components/modules/ReportsView.tsx` (novo) | Tela "Relatórios": escolher dia/período, carregar dados, baixar Excel |
| `components/modules/StoreModule.tsx` (editar) | aba `relatorios`; filtros novos + chips no histórico de vendas |
| `scripts/testes/salesFilters.test.ts`, `scripts/testes/fechamentoXlsx.test.ts` (novos) | testes |
| `package.json` (editar) | dependência `exceljs` |

---

### Task 1: Filtros combináveis do histórico (biblioteca pura)

**Files:**
- Create: `lib/reports/salesFilters.ts`
- Test: `scripts/testes/salesFilters.test.ts`

**Interfaces:**
- Produces:
  - `interface SalesFilters { operator: string; method: string; brand: string; table: string; status: 'all' | 'delivered' | 'canceled'; invoice: 'all' | 'with' | 'without'; hourFrom: string; hourTo: string; }` (strings vazias = sem filtro; horas `'HH:MM'` no fuso America/Bahia)
  - `const EMPTY_FILTERS: SalesFilters`
  - `applySalesFilters(orders: Order[], f: SalesFilters): Order[]`
  - `describeFilters(f: SalesFilters): { key: keyof SalesFilters; label: string }[]` (um chip por filtro ativo)
  - `activeFilterCount(f: SalesFilters): number`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// rodar com: npx tsx scripts/testes/salesFilters.test.ts
import assert from 'node:assert/strict';
import { applySalesFilters, describeFilters, activeFilterCount, EMPTY_FILTERS } from '../../lib/reports/salesFilters';

const o = (id: string, extra: any = {}) => ({ id, status: 'delivered', order_type: 'table', total: 10, created_at: '2026-10-03T22:00:00Z', tables: { number: 8 }, order_items: [], ...extra });
const pago = (operador: string, methods: any[], emitir = true) => ({ operador_nome: operador, emitir_nota: emitir, methods });

const orders: any[] = [
  o('a', { payment_details: pago('Claudia', [{ method: 'CREDIT', brand: 'visa', amount: 10 }]) }),
  o('b', { payment_details: pago('Renato', [{ method: 'PIX', amount: 10 }], false), tables: { number: 11 } }),
  o('c', { status: 'canceled' }), // sem payment_details
  o('d', { payment_details: pago('Claudia', [{ method: 'DEBIT', brand: 'mastercard', amount: 10 }]), created_at: '2026-10-04T02:30:00Z' }), // 23:30 BRT do dia 03
];

assert.equal(applySalesFilters(orders, EMPTY_FILTERS).length, 4, 'sem filtro devolve tudo');
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, operator: 'Claudia' }).map((x) => x.id), ['a', 'd']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, method: 'PIX' }).map((x) => x.id), ['b']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, brand: 'visa' }).map((x) => x.id), ['a']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, table: '11' }).map((x) => x.id), ['b']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, status: 'canceled' }).map((x) => x.id), ['c']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, invoice: 'without' }).map((x) => x.id), ['b']);
// Review Focus 2: pedido sem payment_details não vira "Dinheiro" nem quebra
assert.equal(applySalesFilters(orders, { ...EMPTY_FILTERS, method: 'CASH' }).length, 0);
// Review Focus 5: 02:30Z = 23:30 em Bahia (UTC-3); faixa 23:00-23:59 pega só o 'd'
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, hourFrom: '23:00', hourTo: '23:59' }).map((x) => x.id), ['d']);
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, hourFrom: '19:00', hourTo: '19:30' }).map((x) => x.id), ['a', 'b', 'c']); // 22:00Z = 19:00 BRT
// combinação (AND)
assert.deepEqual(applySalesFilters(orders, { ...EMPTY_FILTERS, operator: 'Claudia', method: 'DEBIT' }).map((x) => x.id), ['d']);
// chips
assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
assert.deepEqual(describeFilters({ ...EMPTY_FILTERS, operator: 'Claudia', method: 'CREDIT' }).map((c) => c.label), ['Operador: Claudia', 'Forma: Crédito']);
console.log('salesFilters: ok');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas" && npx tsx scripts/testes/salesFilters.test.ts`
Expected: FAIL com "Cannot find module '../../lib/reports/salesFilters'"

- [ ] **Step 3: Implementação mínima**

```ts
// lib/reports/salesFilters.ts
import type { Order } from '@/types';
import { getPaymentMethodLabel } from '../labels';
import { localDayAndMinutes } from '../priceSchedule';

export interface SalesFilters {
  operator: string;
  method: string;
  brand: string;
  table: string;
  status: 'all' | 'delivered' | 'canceled';
  invoice: 'all' | 'with' | 'without';
  hourFrom: string;
  hourTo: string;
}

export const EMPTY_FILTERS: SalesFilters = { operator: '', method: '', brand: '', table: '', status: 'all', invoice: 'all', hourFrom: '', hourTo: '' };

const toMinutes = (t: string): number => { const [h, m] = t.split(':'); return Number(h) * 60 + Number(m || 0); };

export function applySalesFilters(orders: Order[], f: SalesFilters): Order[] {
  return orders.filter((o) => {
    const pd = (o.payment_details ?? null) as { operador_nome?: string; emitir_nota?: boolean; methods?: { method: string; brand?: string }[] } | null;
    const methods = Array.isArray(pd?.methods) ? pd!.methods! : [];
    if (f.operator && pd?.operador_nome !== f.operator) return false;
    if (f.method && !methods.some((m) => m.method === f.method)) return false;
    if (f.brand && !methods.some((m) => m.brand === f.brand)) return false;
    if (f.table && String((o as any).tables?.number ?? '') !== f.table) return false;
    if (f.status !== 'all' && o.status !== f.status) return false;
    if (f.invoice === 'with' && pd?.emitir_nota !== true) return false;
    if (f.invoice === 'without' && !(pd && pd.emitir_nota === false)) return false;
    if (f.hourFrom || f.hourTo) {
      const { minutes } = localDayAndMinutes(new Date(o.created_at), 'America/Bahia');
      if (f.hourFrom && minutes < toMinutes(f.hourFrom)) return false;
      if (f.hourTo && minutes > toMinutes(f.hourTo)) return false;
    }
    return true;
  });
}

export function describeFilters(f: SalesFilters): { key: keyof SalesFilters; label: string }[] {
  const chips: { key: keyof SalesFilters; label: string }[] = [];
  if (f.operator) chips.push({ key: 'operator', label: `Operador: ${f.operator}` });
  if (f.method) chips.push({ key: 'method', label: `Forma: ${getPaymentMethodLabel(f.method)}` });
  if (f.brand) chips.push({ key: 'brand', label: `Bandeira: ${f.brand}` });
  if (f.table) chips.push({ key: 'table', label: `Mesa ${f.table}` });
  if (f.status !== 'all') chips.push({ key: 'status', label: f.status === 'canceled' ? 'Canceladas' : 'Entregues' });
  if (f.invoice !== 'all') chips.push({ key: 'invoice', label: f.invoice === 'with' ? 'Com nota' : 'Sem nota' });
  if (f.hourFrom || f.hourTo) chips.push({ key: 'hourFrom', label: `Horário ${f.hourFrom || '00:00'}–${f.hourTo || '23:59'}` });
  return chips;
}

export const activeFilterCount = (f: SalesFilters): number => describeFilters(f).length;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/testes/salesFilters.test.ts && npx tsc --noEmit`
Expected: `salesFilters: ok` e tsc sem saída

- [ ] **Step 5: Commit**

```bash
git add lib/reports/salesFilters.ts scripts/testes/salesFilters.test.ts
git commit -m "feat(relatorios): filtros combináveis do histórico (operador, forma, bandeira, mesa, status, nota, hora)"
```

---

### Task 2: Excel de fechamento (biblioteca pura)

**Files:**
- Create: `lib/reports/fechamentoXlsx.ts`
- Modify: `package.json` (dependência `exceljs`)
- Test: `scripts/testes/fechamentoXlsx.test.ts`

**Interfaces:**
- Consumes: `completarFormas`, `completarCartoes`, `ticketMedio` de `lib/caixaResumo.ts`; tipo `CashShiftSummary` de `lib/api.ts`; `Order` de `types`; `ExceptionEvent` de `lib/excecoes.ts`.
- Produces:
  - `interface FechamentoTurno { operador: string; abertoEm: string; fechadoEm: string | null; fundo: number; contado: number | null; resumo: CashShiftSummary }`
  - `interface FechamentoData { loja: string; periodoLabel: string; geradoEm: Date; geradoPor: string; turnos: FechamentoTurno[]; vendas: Order[]; excecoes: ExceptionEvent[] }`
  - `buildFechamentoWorkbook(d: FechamentoData): Promise<import('exceljs').Workbook>`
  - `fechamentoFileName(lojaSlug: string, dia: string): string` → `fechamento_2026-10-03_sertao.xlsx`
  - `safeCell(v: string): string` (prefixa `'` se começar com `= + - @`)

- [ ] **Step 1: Instalar a dependência**

Run: `cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas" && npm install exceljs --save`
Expected: `added ... exceljs` sem erro

- [ ] **Step 2: Escrever o teste que falha**

```ts
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
  console.log('fechamentoXlsx: ok');
})();
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx tsx scripts/testes/fechamentoXlsx.test.ts`
Expected: FAIL com "Cannot find module '../../lib/reports/fechamentoXlsx'"

- [ ] **Step 4: Implementação**

```ts
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
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx tsx scripts/testes/fechamentoXlsx.test.ts && npx tsc --noEmit`
Expected: `fechamentoXlsx: ok` e tsc sem saída

- [ ] **Step 6: Commit**

```bash
git add lib/reports/fechamentoXlsx.ts scripts/testes/fechamentoXlsx.test.ts package.json package-lock.json
git commit -m "feat(relatorios): Excel de fechamento multi-aba (resumo, formas, cartões, caixa, vendas, itens, exceções)"
```

---

### Task 3: Tela "Relatórios" com download

**Files:**
- Create: `components/modules/ReportsView.tsx`
- Modify: `components/modules/StoreModule.tsx` (aba `relatorios` em Administração › Operação; import)

**Interfaces:**
- Consumes: `fetchCashShiftsHistory(storeId, limit)`, `fetchCashShiftSummary(shiftId)`, `fetchSalesHistory(storeId, startISO, endISO)`, `fetchExceptionsReport(storeId, from, to)` de `lib/api.ts`; `buildFechamentoWorkbook`, `fechamentoFileName` da Task 2.
- Produces: `ReportsView: React.FC<{ storeId: string; storeName: string; storeSlug: string; userName: string }>`

- [ ] **Step 1: Escrever o componente**

```tsx
// components/modules/ReportsView.tsx
'use client';
import React, { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Button, Card, Input } from '@/components/ui';
import { toast } from '@/components/Toast';
import { fetchCashShiftsHistory, fetchCashShiftSummary, fetchSalesHistory, fetchExceptionsReport } from '@/lib/api';
import { buildFechamentoWorkbook, fechamentoFileName, type FechamentoTurno } from '@/lib/reports/fechamentoXlsx';

const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bahia' });

// Início e fim do dia em Bahia (UTC-3, sem horário de verão) como instantes UTC.
const limitesDoDia = (dia: string): [Date, Date] => [new Date(`${dia}T00:00:00-03:00`), new Date(`${dia}T23:59:59.999-03:00`)];

export const ReportsView: React.FC<{ storeId: string; storeName: string; storeSlug: string; userName: string }> = ({ storeId, storeName, storeSlug, userName }) => {
  const [dia, setDia] = useState(hojeISO());
  const [gerando, setGerando] = useState(false);

  const baixarFechamento = async () => {
    setGerando(true);
    try {
      const [ini, fim] = limitesDoDia(dia);
      const [turnosRows, vendas, exc] = await Promise.all([
        fetchCashShiftsHistory(storeId, 200),
        fetchSalesHistory(storeId, ini.toISOString(), fim.toISOString()),
        fetchExceptionsReport(storeId, ini, fim),
      ]);
      const doDia = turnosRows.filter((t) => new Date(t.opened_at) >= ini && new Date(t.opened_at) <= fim);
      const turnos: FechamentoTurno[] = [];
      for (const t of doDia) {
        // eslint-disable-next-line no-await-in-loop -- poucos turnos por dia
        const resumo = await fetchCashShiftSummary(t.id);
        if (resumo) turnos.push({ operador: t.operator_name ?? 'Equipe', abertoEm: t.opened_at, fechadoEm: t.closed_at, fundo: Number(t.opening_float), contado: t.closing_counted_cash, resumo });
      }
      const wb = await buildFechamentoWorkbook({
        loja: storeName, periodoLabel: new Date(`${dia}T12:00:00-03:00`).toLocaleDateString('pt-BR'), geradoEm: new Date(), geradoPor: userName,
        turnos, vendas, excecoes: exc.events,
      });
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fechamentoFileName(storeSlug, dia);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(turnos.length === 0 ? 'Arquivo gerado (nenhum turno de caixa nesse dia).' : 'Arquivo gerado.');
    } catch (e) {
      console.error('baixarFechamento falhou:', e);
      toast.error('Não consegui gerar o arquivo. Tente de novo.');
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[17px] font-semibold text-[var(--text)]">Relatórios</h3>
        <p className="text-[13px] text-[var(--text-muted)]">Arquivos prontos para o contador conciliar. O Excel traz as abas Resumo, Formas de pagamento, Cartões, Caixa, Vendas, Itens e Exceções.</p>
      </div>
      <Card className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <FileSpreadsheet size={22} className="text-[var(--brand)] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-[15px] font-semibold text-[var(--text)]">Fechamento do dia (Excel)</h4>
            <p className="text-[13px] text-[var(--text-muted)]">Todos os turnos de caixa do dia, com meios de pagamento e bandeiras (inclusive zeradas), ticket médio, vendas, itens e exceções.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[13px] text-[var(--text-muted)]">Dia
            <Input type="date" value={dia} max={hojeISO()} onChange={(e) => setDia(e.target.value)} />
          </label>
          <Button onClick={baixarFechamento} isLoading={gerando} disabled={!dia}><Download size={16} /> Baixar Excel</Button>
        </div>
      </Card>
    </div>
  );
};
```

- [ ] **Step 2: Ligar a aba em Administração**

Em `components/modules/StoreModule.tsx`:
1. import: `import { ReportsView } from './ReportsView';`
2. tipo do estado `activeTab`: acrescentar `| 'relatorios'`
3. em `ADMIN_NAV_GROUPS`, grupo "Operação", depois de `shifts`: `{ id: 'relatorios', label: 'Relatórios' },`
4. render: `{activeTab === 'relatorios' && <ReportsView storeId={storeId} storeName={store.name} storeSlug={store.slug} userName={loggedUser.name} />}`

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sem saída

- [ ] **Step 4: Commit**

```bash
git add components/modules/ReportsView.tsx components/modules/StoreModule.tsx
git commit -m "feat(relatorios): aba Relatórios com download do fechamento do dia em Excel"
```

---

### Task 4: Filtros novos e chips no histórico de vendas

**Files:**
- Modify: `components/modules/StoreModule.tsx` (histórico de vendas: estado `salesFilters`, selects, chips, aplicação em `filteredAndSortedSales`, filtros salvos em localStorage)

**Interfaces:**
- Consumes: `SalesFilters`, `EMPTY_FILTERS`, `applySalesFilters`, `describeFilters`, `activeFilterCount` da Task 1.

- [ ] **Step 1: Estado e aplicação**

Perto de `const [filterMaxTotal, setFilterMaxTotal] = useState('');` acrescentar:

```tsx
const [salesFilters, setSalesFilters] = useState<SalesFilters>(EMPTY_FILTERS);
const [savedFilters, setSavedFilters] = useState<{ name: string; f: SalesFilters }[]>(() => {
    try { return JSON.parse(localStorage.getItem(`saved_sales_filters_${storeId}`) || '[]'); } catch { return []; }
});
const salvarFiltros = (list: { name: string; f: SalesFilters }[]) => {
    setSavedFilters(list);
    try { localStorage.setItem(`saved_sales_filters_${storeId}`, JSON.stringify(list)); } catch { /* sem storage: só não lembra */ }
};
```

Em `filteredAndSortedSales`, no fim da cadeia de filtros (antes do sort), aplicar: `result = applySalesFilters(result, salesFilters);` e incluir `salesFilters` nas dependências do `useMemo`.

- [ ] **Step 2: UI de filtros e chips**

Acima da tabela do histórico, um bloco com `<select>` de operador (opções vindas dos próprios pedidos), forma (CASH/PIX/DEBIT/CREDIT), bandeira (de `CARD_BRAND_LABELS`), status, nota, e dois `<input type="time">` de horário; abaixo, chips removíveis (`describeFilters`) com botão "Limpar" e "Salvar este filtro" (pede um nome com um `Input` inline, sem `prompt()`), e os filtros salvos como botões que aplicam `f`.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && for t in scripts/testes/*.test.ts; do npx tsx "$t" || echo "FALHOU $t"; done`
Expected: sem saída do tsc e nenhum "FALHOU"

- [ ] **Step 4: Commit**

```bash
git add components/modules/StoreModule.tsx
git commit -m "feat(relatorios): filtros por operador, forma, bandeira, mesa, status, nota e horário no histórico, com chips e filtros salvos"
```

---

### Task 5: Passe de design nas telas novas

**Files:**
- Modify: `components/modules/ReportsView.tsx`, `components/modules/ExceptionsReportView.tsx`, `components/modules/PriceSchedulesView.tsx`, `components/modules/FloorPlanView.tsx`

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Conferir os cinco pontos em cada tela nova**

Para cada arquivo: (a) todo valor numérico em coluna usa a classe `num` (fonte tabular, já definida em `app/globals.css`); (b) todo botão de ação tem altura mínima de 44 px (`min-h-11`) no celular; (c) estado nunca só por cor: pílula com texto; (d) estado vazio diz o que fazer; (e) botões vizinhos com `gap-2` ou mais.

- [ ] **Step 2: Ajustar o que faltar**, mudando só classes Tailwind, sem lógica.

- [ ] **Step 3: Verificar e commitar**

Run: `npx tsc --noEmit`
Commit: `git add components/modules && git commit -m "style: passe de acessibilidade (alvos de 44px, números tabulares, estados vazios) nas telas novas"`

---

## Self-review

- **Cobertura:** Excel multi-aba (T2) e download com nome padrão (T3), filtros combináveis + chips + salvos (T1, T4), design (T5). Fora desta rodada, por decisão: drill-down, agendamento por e-mail/WhatsApp e comparação por dia da semana (ficam no backlog do plano de 04/10).
- **Placeholders:** nenhum; os dois blocos de código das bibliotecas estão completos.
- **Tipos:** `SalesFilters`/`EMPTY_FILTERS`/`applySalesFilters`/`describeFilters`/`activeFilterCount` (T1) usados em T4 com os mesmos nomes; `FechamentoTurno`/`FechamentoData`/`buildFechamentoWorkbook`/`fechamentoFileName`/`safeCell` (T2) usados em T3 com os mesmos nomes.
- **Review Focus:** itens 1, 3 e 4 pinados no teste da T2; itens 2 e 5 no teste da T1.
