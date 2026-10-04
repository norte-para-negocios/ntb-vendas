# Relatórios em PDF e Excel (Painel do dia, nas cores do Norte) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O "Fechamento do dia" passa a sair como um relatório bonito e completo, em **Excel** (aba "Painel" + abas de detalhe) **ou PDF/impressão A4**, com as cores do Norte Vendas, total por cartão (crédito e débito separados por bandeira), análises por hora/operador/categoria, ticket médio, produtos mais vendidos e uma propaganda bem pequena do Norte para Negócios; e todos os relatórios da aba passam a poder ser impressos.

**Architecture:** Cálculo puro em `lib/reports/painelDia.ts` (já existe, testado) alimenta duas saídas: (1) `fechamentoXlsx.ts` (ExcelJS, já reescrito em parte) e (2) `relatorioHtml.ts` (HTML A4 puro, impresso por `printHtmlDocument` de `lib/print.ts`; "Salvar como PDF" é pelo diálogo do navegador). Um carregador único (`carregarFechamento.ts`) busca os dados com as mesmas funções de hoje (`fetchCashShiftsHistory`, `fetchCashShiftSummary`, `fetchSalesHistory`, `fetchExceptionsReport`, `fetchMenu`). **Nenhuma regra de cálculo do caixa muda**: ticket médio = total recebido / contas pagas, como em `ticketMedio`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, `exceljs` (já usado, import dinâmico), testes `npx tsx scripts/testes/*.test.ts` + `node:assert`, LibreOffice (`soffice`, já instalado em `/opt/homebrew/bin/soffice`) + `pdftoppm` para conferir o visual do Excel/PDF.

**Spec:** pedido do dono em 04/10/2026: "melhorar o design dos relatórios… relatório de faturamento… bem mais completo e um arquivo bonito, com as cores do Norte Vendas… uma propaganda, Norte para Negócios, bem pequenininha… total recebido por cartão, separando crédito… análises do dia, operador, o dashboard… poder imprimir todos os relatórios" e "cria a opção de PDF ou Excel, pode ser as duas". Contexto: `docs/superpowers/plans/2026-10-04-mesa-cardapio-permissoes.md` (adendo).

## Global Constraints

- **Identidade visual do app não muda** (restrição do dono): nas telas do app que forem tocadas (botões "Baixar Excel" / "PDF / Imprimir", seleção de período) usar só os componentes e tokens que já existem (`Button`, `Card`, `Input`, `SegmentedControl` de `components/ui.tsx`; `var(--brand)`, `var(--surface)`, `var(--text)`…), mesmos ícones `lucide-react`, mesmas animações (`u-press`, `u-motion`). Nada de redesign de tela. O visual novo (azul `#484DB5`, faixa, cartões, barras) vale **só dentro dos arquivos gerados**.
- Cores dos relatórios: `#484DB5` (marca), `#2B2E83` (escuro), `#EEEFFB` (suave), `#9DA1E4` (barras). Fonte do Excel: Calibri. Fonte do PDF: `Arial, Helvetica, sans-serif`.
- Rodapé/propaganda fixo e pequeno: `Norte Vendas · Norte para Negócios · norteparanegocios.com.br`.
- Textos em português do Brasil; moeda `R$ 1.234,56` (`formatBRL` de `lib/calc.ts`); hora sempre em America/Bahia (`horaBahia`, UTC-3).
- Todo texto livre (nome de loja, operador, produto, cliente) passa por `esc()` no HTML e por `safeCell()` no Excel.
- Sem `window.confirm`/`alert`. Falha de geração = `toast.error` em português, nunca silêncio.
- QA **somente** com dados sintéticos ou em loja de TESTE (Donana ou ZZ Laboratório). **NUNCA** "O Sertão Vai Virar Mar". Não criar pedido/nota real; se criar algo, apagar. Sem deploy (deploy só com a loja fechada, em lote, fora deste plano).
- Arquivos gerados em QA ficam em `$SP/rel/` (pasta de scratch da sessão) ou em `~/ClaudeGerado/relatorios-teste/` e são **apagados** ao fim da Task 8.
- Cada task termina com `npx tsc --noEmit` limpo, todos os testes de `scripts/testes/` passando e um commit cuja mensagem termina com:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7
```

Comando padrão de verificação (usado como "rodar tudo" nas tasks):

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
npx tsc --noEmit && for t in scripts/testes/*.test.ts; do npx tsx "$t" || echo "FALHOU $t"; done
```

## Review Focus

1. **Categoria aparecendo como UUID.** `FechamentoData.nomeCategoria` hoje não é passado por `ReportsView.baixarFechamento`; sem isso "Vendas por categoria" mostra o id. Esperado: nome da categoria; produto sem categoria = "Sem categoria". Teste na Task 1 (xlsx) e Task 2 (loader).
2. **Dia sem nenhum turno/venda.** Painel e PDF devem sair com zeros e a mensagem "Nenhuma venda neste período", sem `NaN`, sem erro, sem linha vazia estranha. Testes nas Tasks 1 e 4.
3. **Nome de loja/operador/produto com `<`, `&`, `"` ou começando com `=`.** HTML escapado; célula do Excel não vira fórmula. Testes nas Tasks 1 e 4.
4. **Dia virando meia-noite (venda às 22h–02h) e fuso.** Hora por categoria "19h/20h" deve ser Bahia, não UTC; limites do dia em UTC-3. Teste na Task 2 (`limitesDoDia`) e já coberto em `groupSales`.
5. **Conta com vários pedidos e pagamento dividido** não pode contar em dobro no ticket médio nem nas formas. A fonte de contas/total continua sendo `payments_count`/`payments_total` do resumo do turno (migration 147); o Histórico usa a mesma regra de "conta" de `groupSales`. Teste na Task 6.
6. **Cartões zerados continuam listados** (pedido do Ramon: "todos os meios e bandeiras possíveis"), no Excel e no PDF. Testes nas Tasks 1 e 4.

---

## Estado de partida (verificado em 04/10/2026, nada commitado ainda)

- `lib/reports/painelDia.ts` + `scripts/testes/painelDia.test.ts`: passam.
- `lib/reports/fechamentoXlsx.ts`: reescrito (aba "Painel" primeiro, faixa, cartões, data bars, rodapé, impressão). `npx tsc --noEmit` limpo.
- Conferido de verdade: gerei um xlsx sintético (script em `$SP/rel/gerar.ts`), converti com `soffice --headless … --convert-to pdf` e `pdftoppm -png` e olhei a página 1. **Funciona** (abas: Painel | Formas de pagamento | Cartões | Caixa | Vendas | Itens | Exceções; 20 células mescladas, 6 regras de barra). **Problemas encontrados no render**, corrigidos na Task 1:
  1. fonte serifada (cada `font` criado sem `name`);
  2. faixa/cartões ocupam 8 colunas, mas as tabelas só 5 → o lado direito fica vazio e desbalanceado;
  3. rodapé duplicado (linha dentro da planilha + `oddFooter`);
  4. sobras de código (`void recebido…`, `wb.views`/`splice` desnecessários);
  5. `nomeCategoria` nunca é passado pela tela (Review Focus 1).

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/reports/dia.ts` (novo) | `hojeISO`, `limitesDoDia`, `turnosDoPeriodo` (puro) |
| `lib/reports/carregarFechamento.ts` (novo) | busca tudo do dia e devolve `FechamentoData` |
| `lib/reports/painelDia.ts` (existe) | cálculo do painel; ganha `montarPainelDeVendas` (Task 6) |
| `lib/reports/fechamentoXlsx.ts` (existe) | Excel; layout corrigido na Task 1 |
| `lib/reports/norteMarca.ts` (novo, gerado) | símbolo do Norte como SVG inline pequeno |
| `lib/reports/relatorioHtml.ts` (novo) | HTML A4 do relatório e tabela genérica (puro) |
| `lib/print.ts` (editar) | `printRelatorioDia`, `printTabela` |
| `components/modules/ReportsView.tsx` (editar) | botões Excel / PDF-Imprimir, Imprimir nos outros relatórios |
| `components/modules/ExceptionsReportView.tsx` (editar) | botão Imprimir |
| `components/modules/StoreModule.tsx` (editar, ~11640 e ~12310) | Histórico de vendas: menu "Relatório" |
| `scripts/testes/{dia,fechamentoXlsx,norteMarca,relatorioHtml}.test.ts` (novos) | testes |

---

### Task 1: Corrigir e travar o Excel (aba Painel)

**Files:**
- Modify: `lib/reports/fechamentoXlsx.ts`
- Create: `scripts/testes/fechamentoXlsx.test.ts`

**Interfaces:**
- Produces: `FechamentoData` ganha `painel?: PainelDia` (se vier, substitui `montarPainel(d, …)`; usado pelo Histórico na Task 6). `buildFechamentoWorkbook(d): Promise<Workbook>` continua com a mesma assinatura. Abas `Caixa` e `Exceções` só são criadas se houver dados (`d.turnos.length > 0` / `d.excecoes.length > 0`).

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/fechamentoXlsx.test.ts
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildFechamentoWorkbook, NORTE_RODAPE } from '../../lib/reports/fechamentoXlsx';

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

  // Dia vazio (Review Focus 2)
  const vazio = await ler(await buildFechamentoWorkbook({ ...base, turnos: [], vendas: [] }));
  assert.deepEqual(vazio.worksheets.map((w) => w.name), ['Painel', 'Formas de pagamento', 'Cartões', 'Vendas', 'Itens']);
  vazio.getWorksheet('Painel')!.eachRow((row) => row.eachCell((c) => { assert.ok(!(typeof c.value === 'number' && Number.isNaN(c.value)), 'sem NaN'); }));
  console.log('fechamentoXlsx: ok');
})();
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx scripts/testes/fechamentoXlsx.test.ts` → falha em "Painel é a 1ª aba…" (Exceções vazia existe) e na fonte.

- [ ] **Step 3: Implementação (substituir o que for indicado em `fechamentoXlsx.ts`)**

3a. Constantes e tipo (topo do arquivo):

```ts
const FONT = 'Calibri';
export interface FechamentoData { painel?: PainelDia; nomeCategoria?: (id: string) => string | undefined; loja: string; periodoLabel: string; geradoEm: Date; geradoPor: string; turnos: FechamentoTurno[]; vendas: Order[]; excecoes: ExceptionEvent[] }
```

3b. No início de `buildFechamentoWorkbook`, trocar o bloco `const painel… void sangria…` por:

```ts
  const painel = d.painel ?? montarPainel(d, d.nomeCategoria);
  montarPainelSheet(wb, d, painel);
```

3c. Aba Caixa e Exceções só com dados: envolver o bloco `// 4. Caixa` em `if (d.turnos.length > 0) { … }` e o bloco `// 7. Exceções` em `if (d.excecoes.length > 0) { … }`.

3d. Reescrever as larguras, as tabelas (oito colunas, barra de participação mesclada em E:H) e o rodapé dentro de `montarPainelSheet`. Substituir `ws.columns = …` por:

```ts
  // 4 cartões de 40 de largura (A+B, C+D, E+F, G+H); as tabelas usam A=rótulo B=total C=contas D=ticket E:H=participação.
  ws.columns = [{ width: 26 }, { width: 14 }, { width: 14 }, { width: 26 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }];
```

Substituir as funções `secao`, `barras`, `bloco` por:

```ts
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
  if (p.porHora.length === 0) { const r = ws.addRow(['Nenhuma venda neste período.']); ws.mergeCells(r.number, 1, r.number, COLS); r.getCell(1).font = { italic: true, color: { argb: 'FF666A75' } }; r.getCell(1).alignment = { indent: 1 }; }
```

Rodapé: manter só a linha dentro da planilha (já em `rod.value = NORTE_RODAPE`, trocar o merge para `A${n}:H${n}` com `const n = ws.rowCount + 1; ws.mergeCells(\`A${n}:H${n}\`); const rod = ws.getCell(\`A${n}\`);`) e **remover** o trecho final `wb.views = …` / `splice` (o Painel já é criado primeiro). No pós-processamento global do `buildFechamentoWorkbook`, trocar `oddFooter` por `\`&LNorte Vendas&RPágina &P de &N\`` (a propaganda completa já está dentro da folha) e `orientation: 'landscape'` também para o Painel (`fitToHeight: 0` mantém várias páginas se precisar).

3e. Fonte única, **depois** de criar todas as abas, antes do `return wb`:

```ts
  wb.worksheets.forEach((ws) => ws.eachRow({ includeEmpty: true }, (row) => row.eachCell({ includeEmpty: true }, (c) => { c.font = { name: FONT, size: 11, ...(c.font ?? {}) }; })));
```

e em `headerRow`, `r.font = { name: FONT, bold: true, … }` (para o `size` não ser sobrescrito, o spread acima respeita o que já existe).

- [ ] **Step 4: Rodar e ver passar** — `npx tsx scripts/testes/fechamentoXlsx.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Conferir o visual de verdade (não é opcional)**

```bash
SP=/private/tmp/claude-501/-Users-joaquimsalles/c6bc8184-59d3-420a-a93b-f78ddbc44bd9/scratchpad/rel
cd $SP && npx tsx gerar.ts $SP/teste.xlsx      # gerar.ts já existe; node_modules aponta para o projeto
soffice --headless --norestore -env:UserInstallation=file:///tmp/lo_prof_rel --convert-to pdf --outdir $SP $SP/teste.xlsx
pdftoppm -r 80 -png -f 1 -l 1 $SP/teste.pdf $SP/pag
```
Abrir `$SP/pag-1.png` (Read) e conferir: sem serifa; faixa e tabelas com a mesma largura (A:H); barras visíveis na coluna de participação; título da loja legível; rodapé único. Ajustar larguras se algo cortar (`####` em moeda = coluna estreita).

- [ ] **Step 6: Commit** — `git add lib/reports/fechamentoXlsx.ts lib/reports/painelDia.ts scripts/testes/painelDia.test.ts scripts/testes/fechamentoXlsx.test.ts && git commit -m "feat(relatorios): Excel do fechamento com aba Painel nas cores do Norte" -m "…" ` (mensagem terminando com as duas linhas de atribuição do topo do plano).

---

### Task 2: Datas do período e carregador único dos dados

**Files:**
- Create: `lib/reports/dia.ts`, `lib/reports/carregarFechamento.ts`, `scripts/testes/dia.test.ts`
- Modify: `components/modules/ReportsView.tsx` (usa o carregador; mantém o visual)

**Interfaces:**
- Produces: `hojeISO(): string`; `limitesDoDia(dia: string): [Date, Date]`; `turnosDoPeriodo<T extends { opened_at: string }>(rows: T[], ini: Date, fim: Date): T[]`; `carregarFechamento(p: { storeId: string; storeName: string; userName: string; dia: string }): Promise<FechamentoData>`.

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/dia.test.ts
import assert from 'node:assert/strict';
import { limitesDoDia, turnosDoPeriodo } from '../../lib/reports/dia';

const [ini, fim] = limitesDoDia('2026-10-04');
assert.equal(ini.toISOString(), '2026-10-04T03:00:00.000Z', 'início do dia em Bahia (UTC-3)');
assert.equal(fim.toISOString(), '2026-10-05T02:59:59.999Z', 'fim do dia em Bahia');
const rows = [
  { id: 'a', opened_at: '2026-10-04T02:59:59.000Z' }, // 23h59 do dia anterior em Bahia
  { id: 'b', opened_at: '2026-10-04T03:00:00.000Z' }, // 00h00
  { id: 'c', opened_at: '2026-10-05T02:59:59.000Z' }, // 23h59
  { id: 'd', opened_at: '2026-10-05T03:00:00.000Z' }, // dia seguinte
];
assert.deepEqual(turnosDoPeriodo(rows, ini, fim).map((r) => r.id), ['b', 'c'], 'turno que abre à noite conta no dia em que abriu (Review Focus 4)');
console.log('dia: ok');
```

- [ ] **Step 2: Rodar e ver falhar** (módulo inexistente).

- [ ] **Step 3: Implementação**

```ts
// lib/reports/dia.ts
export const hojeISO = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bahia' });

// Início e fim do dia em Bahia (UTC-3, sem horário de verão) como instantes UTC.
export const limitesDoDia = (dia: string): [Date, Date] => [new Date(`${dia}T00:00:00-03:00`), new Date(`${dia}T23:59:59.999-03:00`)];

export function turnosDoPeriodo<T extends { opened_at: string }>(rows: T[], ini: Date, fim: Date): T[] {
  return rows.filter((t) => { const d = new Date(t.opened_at); return d >= ini && d <= fim; });
}
```

```ts
// lib/reports/carregarFechamento.ts
import { fetchCashShiftsHistory, fetchCashShiftSummary, fetchSalesHistory, fetchExceptionsReport, fetchMenu } from '../api';
import { limitesDoDia, turnosDoPeriodo } from './dia';
import type { FechamentoData, FechamentoTurno } from './fechamentoXlsx';

export async function carregarFechamento(p: { storeId: string; storeName: string; userName: string; dia: string }): Promise<FechamentoData> {
  const [ini, fim] = limitesDoDia(p.dia);
  const [turnosRows, vendas, exc, menu] = await Promise.all([
    fetchCashShiftsHistory(p.storeId, 200),
    fetchSalesHistory(p.storeId, ini.toISOString(), fim.toISOString()),
    fetchExceptionsReport(p.storeId, ini, fim),
    fetchMenu(p.storeId, false, true),
  ]);
  const turnos: FechamentoTurno[] = [];
  for (const t of turnosDoPeriodo(turnosRows, ini, fim)) {
    // eslint-disable-next-line no-await-in-loop -- poucos turnos por dia
    const resumo = await fetchCashShiftSummary(t.id);
    if (resumo) turnos.push({ operador: t.operator_name ?? 'Equipe', abertoEm: t.opened_at, fechadoEm: t.closed_at, fundo: Number(t.opening_float), contado: t.closing_counted_cash, resumo });
  }
  const nomes = new Map(menu.categories.map((c) => [c.id, c.name]));
  return {
    loja: p.storeName, periodoLabel: new Date(`${p.dia}T12:00:00-03:00`).toLocaleDateString('pt-BR'), geradoEm: new Date(), geradoPor: p.userName,
    turnos, vendas, excecoes: exc.events, nomeCategoria: (id) => nomes.get(id),
  };
}
```

- [ ] **Step 4: Usar no `ReportsView.tsx`** — apagar as constantes locais `hojeISO` e `limitesDoDia` e importar de `@/lib/reports/dia`; trocar o miolo de `baixarFechamento` (o `try` até o `buildFechamentoWorkbook`) por:

```ts
      const dados = await carregarFechamento({ storeId, storeName, userName, dia });
      const wb = await buildFechamentoWorkbook(dados);
```
mantendo o restante (Blob, download, `toast.success(dados.turnos.length === 0 …)`). Remover imports que ficarem sem uso (`fetchExceptionsReport`, `FechamentoTurno`). **Nenhuma mudança visual.**

- [ ] **Step 5: Rodar tudo** (comando padrão) e **Step 6: Commit** — `feat(relatorios): datas do período e carregador único do fechamento (categoria pelo nome)`.

---

### Task 3: Símbolo do Norte como SVG inline pequeno

**Files:**
- Create: `lib/reports/norteMarca.ts` (gerado), `scripts/testes/norteMarca.test.ts`

**Interfaces:**
- Produces: `NORTE_SIMBOLO_SVG: string` (SVG de ~4 KB, símbolo N+foguete na cor `#484DB5`, **sem** fundo, `viewBox` próprio, sem `<script>`).

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/norteMarca.test.ts
import assert from 'node:assert/strict';
import { NORTE_SIMBOLO_SVG } from '../../lib/reports/norteMarca';
assert.ok(NORTE_SIMBOLO_SVG.startsWith('<svg'), 'é um svg');
assert.ok(NORTE_SIMBOLO_SVG.includes('viewBox='), 'tem viewBox');
assert.ok(!NORTE_SIMBOLO_SVG.includes('<rect'), 'sem quadrado de fundo');
assert.ok(NORTE_SIMBOLO_SVG.includes('#484DB5'), 'na cor da marca');
assert.ok(!/<script|onload|href=/i.test(NORTE_SIMBOLO_SVG), 'sem script/links');
assert.ok(NORTE_SIMBOLO_SVG.length < 8000, 'pequeno o bastante para ir no bundle');
console.log('norteMarca: ok');
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Gerar o arquivo a partir do logo oficial** (`~/ClaudeGerado/Logo Norte para Negocios/logo-azul.svg`: símbolo 4 KB sobre um quadrado escuro). Script único (não vai para o repo):

```bash
node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const src=fs.readFileSync(path.join(os.homedir(),"ClaudeGerado","Logo Norte para Negocios","logo-azul.svg"),"utf8");
const limpo=src.replace(/<rect[^>]*\/>/,"").replace(/fill="#FBFBFE"/g,"fill=\"#484DB5\"").replace(/\s+/g," ").trim();
if(limpo.includes("<rect")||!limpo.includes("#484DB5")) throw new Error("svg inesperado: conferir o arquivo de origem");
fs.writeFileSync("lib/reports/norteMarca.ts","// Gerado de ~/ClaudeGerado/Logo Norte para Negocios/logo-azul.svg (símbolo oficial, sem fundo, na cor da marca).\nexport const NORTE_SIMBOLO_SVG = "+JSON.stringify(limpo)+";\n");
'
```
Se o `fill` do símbolo no arquivo de origem não for `#FBFBFE`, o script falha de propósito: abrir o SVG, achar a cor do `<g fill=…>` e ajustar o `replace`. Olhar o símbolo renderizado: `soffice`/Chrome não é necessário, basta conferir na Task 8 dentro do PDF.

- [ ] **Step 4: Rodar e ver passar** + **Step 5: Commit** — `feat(relatorios): símbolo do Norte inline para os relatórios`.

---

### Task 4: Relatório A4 em HTML (imprimir / salvar como PDF)

**Files:**
- Create: `lib/reports/relatorioHtml.ts`, `scripts/testes/relatorioHtml.test.ts`

**Interfaces:**
- Consumes: `PainelDia` (de `painelDia.ts`), `NORTE_SIMBOLO_SVG`, `formatBRL`.
- Produces: `esc(s: string): string`; `interface RelatorioMeta { loja: string; periodoLabel: string; geradoEm: Date; geradoPor: string; titulo?: string }`; `RELATORIO_STYLES: string`; `buildRelatorioHtml(p: PainelDia, m: RelatorioMeta): string`; `buildTabelaHtml(t: { titulo: string; subtitulo?: string; colunas: { rotulo: string; direita?: boolean }[]; linhas: string[][]; rodapeLinha?: string[] }, m: RelatorioMeta): string`.

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/relatorioHtml.test.ts
import assert from 'node:assert/strict';
import { montarPainel } from '../../lib/reports/painelDia';
import { buildRelatorioHtml, buildTabelaHtml, esc } from '../../lib/reports/relatorioHtml';

const meta = { loja: 'Loja <b>X</b> & "Cia"', periodoLabel: '04/10/2026', geradoEm: new Date('2026-10-05T01:00:00Z'), geradoPor: 'QA' };
const resumo: any = { totals_by_method: { CASH: 100, CREDIT: 300 }, totals_by_card: { 'CREDIT|visa': 200, 'CREDIT|elo': 100 }, payments_count: 4, payments_total: 400, total_sangria: 0, total_suprimento: 0, service_fee_total: 40 };
const it = (n: string, q: number, p: number) => ({ id: n, quantity: q, price_at_time: p, status: 'delivered', product: { name: n, category_id: 'c1' } });
const venda = (id: string, h: string, itens: any[], op: string): any => ({ id, table_id: id, status: 'delivered', created_at: h, order_type: 'table', total: 100, payment_details: { operador_nome: op, methods: [{ method: 'CASH', amount: 100 }] }, order_items: itens });
const painel = montarPainel({ ...meta, excecoes: [], turnos: [{ operador: 'A', abertoEm: '', fechadoEm: null, fundo: 0, contado: null, resumo }],
  vendas: [venda('1', '2026-10-04T22:00:00Z', [it('Pizza <img>', 1, 100)], 'ANE'), venda('2', '2026-10-04T23:00:00Z', [it('Pizza <img>', 1, 50)], 'B')] }, () => 'Pizzas');

const html = buildRelatorioHtml(painel, meta);
assert.ok(!html.includes('<b>X</b>') && html.includes('Loja &lt;b&gt;X&lt;/b&gt; &amp; &quot;Cia&quot;'), 'loja escapada (Review Focus 3)');
assert.ok(!html.includes('<img>'), 'produto escapado');
assert.ok(html.includes('Norte Vendas') && html.includes('norteparanegocios.com.br'), 'propaganda pequena do Norte');
assert.ok(html.includes('#484DB5'), 'cor da marca');
assert.ok(html.includes('<svg'), 'símbolo do Norte');
assert.ok(html.includes('Hipercard crédito'), 'bandeira zerada listada (Review Focus 6)');
assert.ok(html.includes('Visa crédito') && html.includes('R$ 200,00'), 'total por bandeira de crédito');
assert.ok(html.includes('style="width:100%"'), 'a maior barra ocupa 100%');
assert.ok(!/NaN|undefined/.test(html), 'sem NaN/undefined');
assert.ok(html.includes('Ticket médio'), 'ticket médio');

const vazio = buildRelatorioHtml(montarPainel({ ...meta, excecoes: [], turnos: [], vendas: [] }), meta);
assert.ok(vazio.includes('Nenhuma venda neste período') && !/NaN|undefined/.test(vazio), 'dia vazio (Review Focus 2)');

const tab = buildTabelaHtml({ titulo: 'Análise por hora', colunas: [{ rotulo: 'Hora' }, { rotulo: 'Total', direita: true }], linhas: [['19h', 'R$ 100,00']], rodapeLinha: ['TOTAL', 'R$ 100,00'] }, meta);
assert.ok(tab.includes('Análise por hora') && tab.includes('R$ 100,00') && tab.includes('norteparanegocios.com.br'), 'tabela genérica com rodapé do Norte');
assert.equal(esc('<&>"\''), '&lt;&amp;&gt;&quot;&#39;');
console.log('relatorioHtml: ok');
```

- [ ] **Step 2: Rodar e ver falhar** (módulo inexistente).

- [ ] **Step 3: Implementação**

```ts
// lib/reports/relatorioHtml.ts — relatório do dia em A4 (puro: devolve strings; quem imprime é lib/print.ts).
import type { PainelDia } from './painelDia';
import { NORTE_SIMBOLO_SVG } from './norteMarca';
import { formatBRL } from '../calc';

export interface RelatorioMeta { loja: string; periodoLabel: string; geradoEm: Date; geradoPor: string; titulo?: string }
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const brl = (n: number) => `R$ ${formatBRL(Number.isFinite(n) ? n : 0)}`;
const pctTxt = (n: number) => `${(Number.isFinite(n) ? n * 100 : 0).toFixed(1).replace('.', ',')}%`;
const RODAPE = 'Norte Vendas · Norte para Negócios · norteparanegocios.com.br';

export const RELATORIO_STYLES = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; color: #14163A; margin: 0; font-size: 11px; }
  .topo { display: flex; align-items: center; gap: 8px; background: #2B2E83; color: #DCDEF8; padding: 7px 12px; font-size: 10px; letter-spacing: .04em; }
  .topo svg { width: 18px; height: 18px; fill: #FFFFFF; }
  .topo svg path { fill: #FFFFFF; }
  .capa { background: #484DB5; color: #fff; padding: 12px 12px 14px; }
  .capa h1 { margin: 0; font-size: 22px; }
  .capa p { margin: 3px 0 0; color: #DCDEF8; font-size: 10.5px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; }
  .kpi { background: #EEEFFB; border-radius: 6px; padding: 7px 9px; break-inside: avoid; }
  .kpi small { display: block; color: #666A75; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
  .kpi b { display: block; margin-top: 2px; font-size: 16px; color: #2B2E83; }
  h2 { margin: 12px 0 0; background: #484DB5; color: #fff; font-size: 11.5px; padding: 5px 9px; border-radius: 4px 4px 0 0; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; break-inside: avoid; }
  th { background: #EEEFFB; color: #2B2E83; font-size: 8.5px; text-transform: uppercase; text-align: left; padding: 4px 9px; }
  td { padding: 4px 9px; border-bottom: 1px solid #E4E5F2; }
  td.d, th.d { text-align: right; }
  td.zero { color: #8A8EA0; }
  tr.tot td { font-weight: 700; border-top: 1.5px solid #484DB5; border-bottom: 0; }
  .bar { width: 100%; height: 7px; background: #EEEFFB; border-radius: 4px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: #9DA1E4; }
  .vazio { color: #666A75; font-style: italic; padding: 8px 9px; }
  .duas { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .rodape { margin-top: 14px; padding-top: 6px; border-top: 1px solid #E4E5F2; color: #8A8EA0; font-size: 8px; text-align: center; }
`;

const cabecalho = (m: RelatorioMeta, titulo: string) => `
  <div class="topo">${NORTE_SIMBOLO_SVG}<span>NORTE VENDAS · ${esc(titulo)}</span></div>
  <div class="capa"><h1>${esc(m.loja)}</h1><p>${esc(m.periodoLabel)} · gerado em ${esc(m.geradoEm.toLocaleString('pt-BR'))} por ${esc(m.geradoPor)}</p></div>`;
const rodape = `<div class="rodape">${esc(RODAPE)}</div>`;

function tabela(titulo: string, cols: { rotulo: string; direita?: boolean }[], linhas: { cels: string[]; zero?: boolean; barra?: number }[], total?: string[]): string {
  const comBarra = linhas.some((l) => l.barra != null);
  return `<h2>${esc(titulo)}</h2><table><thead><tr>${cols.map((c) => `<th class="${c.direita ? 'd' : ''}">${esc(c.rotulo)}</th>`).join('')}${comBarra ? '<th style="width:28%"></th>' : ''}</tr></thead><tbody>
    ${linhas.map((l) => `<tr>${l.cels.map((c, i) => `<td class="${cols[i]?.direita ? 'd' : ''} ${l.zero ? 'zero' : ''}">${esc(c)}</td>`).join('')}${comBarra ? `<td><div class="bar"><i style="width:${Math.max(0, Math.min(100, Math.round((l.barra ?? 0) * 100)))}%"></i></div></td>` : ''}</tr>`).join('')}
    ${total ? `<tr class="tot">${total.map((c, i) => `<td class="${cols[i]?.direita ? 'd' : ''}">${esc(c)}</td>`).join('')}${comBarra ? '<td></td>' : ''}</tr>` : ''}
  </tbody></table>`;
}

// Barra relativa à maior linha (a maior ocupa 100%).
const relativas = <T,>(xs: T[], valor: (x: T) => number): number[] => { const max = Math.max(0, ...xs.map(valor)); return xs.map((x) => (max > 0 ? valor(x) / max : 0)); };

export function buildRelatorioHtml(p: PainelDia, m: RelatorioMeta): string {
  const k = p.kpis;
  const cards: [string, string][] = [
    ['Total recebido', brl(k.recebido)], ['Contas pagas', String(k.contas)], ['Ticket médio', k.ticket != null ? brl(k.ticket) : '—'], ['Itens vendidos', String(k.itens)],
    ['Cartão de crédito', brl(k.credito)], ['Cartão de débito', brl(k.debito)], ['Taxa de serviço', brl(k.taxa)], ['Cancelamentos', String(k.cancelamentos)],
  ];
  const somar = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const rel = (xs: { total: number }[]) => relativas(xs, (x) => x.total);
  const sem = p.porHora.length === 0;
  const formas = tabela('Formas de pagamento', [{ rotulo: 'Forma' }, { rotulo: 'Total', direita: true }, { rotulo: '%', direita: true }],
    p.formas.map((f, i) => ({ cels: [f.label, brl(f.total), pctTxt(k.recebido > 0 ? f.total / k.recebido : 0)], zero: f.total === 0, barra: rel(p.formas)[i] })), ['TOTAL', brl(somar(p.formas.map((f) => f.total))), '']);
  const cartoes = tabela('Cartões por bandeira (crédito e débito separados)', [{ rotulo: 'Bandeira' }, { rotulo: 'Total', direita: true }],
    p.cartoes.map((c, i) => ({ cels: [c.label, brl(c.total)], zero: c.total === 0, barra: rel(p.cartoes)[i] })), ['TOTAL EM CARTÕES', brl(somar(p.cartoes.map((c) => c.total)))]);
  const hora = tabela('Vendas por hora', [{ rotulo: 'Hora' }, { rotulo: 'Total', direita: true }, { rotulo: 'Contas', direita: true }, { rotulo: 'Ticket', direita: true }],
    p.porHora.map((r, i) => ({ cels: [r.label, brl(r.total), String(r.orders), brl(r.ticket)], barra: rel(p.porHora)[i] })));
  const oper = tabela('Vendas por operador', [{ rotulo: 'Operador' }, { rotulo: 'Total', direita: true }, { rotulo: 'Contas', direita: true }, { rotulo: 'Ticket', direita: true }],
    p.porOperador.map((r, i) => ({ cels: [r.label, brl(r.total), String(r.orders), brl(r.ticket)], barra: rel(p.porOperador)[i] })));
  const cat = tabela('Vendas por categoria', [{ rotulo: 'Categoria' }, { rotulo: 'Total', direita: true }],
    p.porCategoria.map((r, i) => ({ cels: [r.label, brl(r.total)], barra: rel(p.porCategoria)[i] })));
  const top = tabela('Produtos mais vendidos', [{ rotulo: 'Produto' }, { rotulo: 'Qtd', direita: true }, { rotulo: 'Total', direita: true }],
    p.topProdutos.map((r, i) => ({ cels: [r.nome, String(r.qtd), brl(r.total)], barra: rel(p.topProdutos)[i] })));
  return `${cabecalho(m, m.titulo ?? 'Relatório do dia')}
    <div class="kpis">${cards.map(([l, v]) => `<div class="kpi"><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('')}</div>
    <div class="duas"><div>${formas}</div><div>${cartoes}</div></div>
    ${sem ? '<p class="vazio">Nenhuma venda neste período.</p>' : `<div class="duas"><div>${hora}</div><div>${oper}</div></div><div class="duas"><div>${cat}</div><div>${top}</div></div>`}
    ${rodape}`;
}

export function buildTabelaHtml(t: { titulo: string; subtitulo?: string; colunas: { rotulo: string; direita?: boolean }[]; linhas: string[][]; rodapeLinha?: string[] }, m: RelatorioMeta): string {
  return `${cabecalho(m, t.titulo)}
    ${t.subtitulo ? `<p style="margin:8px 0 0;color:#666A75">${esc(t.subtitulo)}</p>` : ''}
    ${t.linhas.length === 0 ? '<p class="vazio">Nada para mostrar neste período.</p>' : tabela(t.titulo, t.colunas, t.linhas.map((cels) => ({ cels })), t.rodapeLinha)}
    ${rodape}`;
}
```

Nota: o `topo` pinta o símbolo de branco por CSS (`fill`) porque o SVG inline vem na cor da marca e o topo é escuro; se o símbolo sumir no render da Task 8, trocar o seletor para `.topo svg g { fill: #fff }`.

- [ ] **Step 4: Rodar e ver passar** — `npx tsx scripts/testes/relatorioHtml.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit** — `feat(relatorios): relatório A4 em HTML (painel do dia e tabela genérica)`.

---

### Task 5: Botões "Baixar Excel" e "PDF / Imprimir" na aba Relatórios

**Files:**
- Modify: `lib/print.ts` (exports novos), `components/modules/ReportsView.tsx`

**Interfaces:**
- Consumes: `carregarFechamento`, `montarPainel`, `buildRelatorioHtml`, `buildTabelaHtml`, `RELATORIO_STYLES`.
- Produces (em `lib/print.ts`): `printRelatorioDia(p: PainelDia, m: RelatorioMeta): Promise<boolean>`; `printTabela(t: Parameters<typeof buildTabelaHtml>[0], m: RelatorioMeta): Promise<boolean>`.

- [ ] **Step 1: `lib/print.ts`** — no topo, importar `import { buildRelatorioHtml, buildTabelaHtml, RELATORIO_STYLES, type RelatorioMeta } from './reports/relatorioHtml'; import type { PainelDia } from './reports/painelDia';` e, depois de `printSalesReport`:

```ts
// Relatório do dia (A4). "Salvar como PDF" é pelo próprio diálogo de impressão do navegador.
export function printRelatorioDia(p: PainelDia, m: RelatorioMeta): Promise<boolean> {
  return printHtmlDocument(`Relatório do dia - ${m.loja} - ${m.periodoLabel}`, RELATORIO_STYLES, buildRelatorioHtml(p, m));
}

// Qualquer relatório em tabela (análise por hora/operador, turno, exceções) com o mesmo cabeçalho e rodapé.
export function printTabela(t: Parameters<typeof buildTabelaHtml>[0], m: RelatorioMeta): Promise<boolean> {
  return printHtmlDocument(`${t.titulo} - ${m.loja} - ${m.periodoLabel}`, RELATORIO_STYLES, buildTabelaHtml(t, m));
}
```

- [ ] **Step 2: `ReportsView.tsx`** — imports novos: `Printer` de `lucide-react`; `import { printRelatorioDia } from '@/lib/print'; import { montarPainel } from '@/lib/reports/painelDia';`. Novo estado e handler (junto de `baixarFechamento`):

```tsx
  const [imprimindo, setImprimindo] = useState(false);
  const imprimirFechamento = async () => {
    setImprimindo(true);
    try {
      const dados = await carregarFechamento({ storeId, storeName, userName, dia });
      const ok = await printRelatorioDia(montarPainel(dados, dados.nomeCategoria), dados);
      if (!ok) toast.error('Não consegui abrir a impressão. Confira o bloqueador de janelas.');
    } catch (e) {
      console.error('imprimirFechamento falhou:', e);
      toast.error('Não consegui gerar o relatório. Tente de novo.');
    } finally {
      setImprimindo(false);
    }
  };
```

No cartão "Fechamento do dia" (mesmos `Card`, `Button`, `Input` e ícones de hoje, **sem mudar o desenho**), trocar a linha do botão por dois botões lado a lado:

```tsx
          <Button onClick={baixarFechamento} isLoading={gerando} disabled={!dia || imprimindo}><Download size={16} /> Baixar Excel</Button>
          <Button variant="secondary" onClick={imprimirFechamento} isLoading={imprimindo} disabled={!dia || gerando}><Printer size={16} /> PDF / Imprimir</Button>
```
e a frase do cartão passa a dizer "Excel ou PDF (na impressão, escolha *Salvar como PDF*)". Os textos do cabeçalho da aba mencionam "Painel" no Excel.

- [ ] **Step 3: Rodar tudo** (comando padrão). **Step 4: Verificação manual leve** em loja de teste (Donana ou ZZ): abrir Administração → Relatórios, escolher o dia de hoje, clicar "PDF / Imprimir" e ver que a janela de impressão abre com o painel (não imprimir de verdade; cancelar). Capturar e comparar com o PDF da Task 8.

- [ ] **Step 5: Commit** — `feat(relatorios): botões Baixar Excel e PDF / Imprimir no fechamento do dia`.

---

### Task 6: Histórico de vendas — painel a partir das vendas filtradas + menu "Relatório"

**Files:**
- Modify: `lib/reports/painelDia.ts` (nova função), `components/modules/StoreModule.tsx` (~11640 e ~12310)
- Create: `scripts/testes/painelVendas.test.ts`

**Interfaces:**
- Produces: `montarPainelDeVendas(vendas: Order[], nomeCategoria?: (id: string) => string | undefined): PainelDia` — mesmo `PainelDia`, mas formas/cartões/contas vêm das próprias vendas (`payment_details.methods`, uma vez por conta: chave `${table_id ?? id}|${JSON.stringify(methods)}`, exatamente a regra de `groupSales`), taxa de serviço = soma de `calcOrderServiceFee` não disponível aqui, então `taxa: 0` e `sangria/suprimento: 0`; `cancelamentos` = pedidos com `status === 'canceled'`.

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/painelVendas.test.ts
import assert from 'node:assert/strict';
import { montarPainelDeVendas } from '../../lib/reports/painelDia';

const pd = (methods: any[], op = 'ANE') => ({ operador_nome: op, methods });
const venda = (id: string, mesa: string, h: string, methods: any[], itens: any[] = [], status = 'delivered'): any => ({ id, table_id: mesa, status, created_at: h, order_type: 'table', total: 0, payment_details: pd(methods), order_items: itens });
const it = (n: string, q: number, p: number) => ({ id: n, quantity: q, price_at_time: p, status: 'delivered', product: { name: n, category_id: 'c1' } });
const metodos = [{ method: 'CREDIT', brand: 'visa', amount: 60 }, { method: 'CASH', amount: 40 }];

const p = montarPainelDeVendas([
  venda('1', 'M1', '2026-10-04T22:00:00Z', metodos, [it('Pizza', 1, 100)]),
  venda('2', 'M1', '2026-10-04T22:05:00Z', metodos, [it('Suco', 1, 10)]),     // mesma conta (2º pedido da mesa): não conta em dobro (Review Focus 5)
  venda('3', 'M2', '2026-10-04T23:00:00Z', [{ method: 'PIX', amount: 50 }], [it('Pizza', 1, 50)]),
  venda('4', 'M3', '2026-10-04T23:10:00Z', [{ method: 'CASH', amount: 5 }], [], 'canceled'),
], () => 'Pizzas');

assert.equal(p.kpis.contas, 2, 'duas contas pagas');
assert.equal(p.kpis.recebido, 150, '60+40 da conta M1 + 50 do PIX');
assert.equal(p.kpis.ticket, 75);
assert.equal(p.kpis.credito, 60);
assert.equal(p.kpis.debito, 0);
assert.equal(p.kpis.cancelamentos, 1);
assert.equal(p.formas.find((f) => f.key === 'CASH')!.total, 40);
assert.equal(p.formas.find((f) => f.key === 'DEBIT')!.total, 0, 'forma fixa zerada continua listada');
assert.equal(p.cartoes.find((c) => c.label === 'Visa crédito')!.total, 60);
assert.equal(montarPainelDeVendas([]).kpis.ticket, null, 'sem vendas: ticket null, não NaN');
console.log('painelVendas: ok');
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementação** (acrescentar em `painelDia.ts`; o miolo de produtos/hora/operador/categoria é reaproveitado — extrair as linhas de `topProdutos`/`porCategoria` de `montarPainel` para uma função interna `analiseDeVendas(vendas, nomeCategoria)` usada pelas duas):

```ts
type Pd = { methods?: { method: string; brand?: string; amount: number }[] } | null;

export function montarPainelDeVendas(vendas: Order[], nomeCategoria: (id: string) => string | undefined = () => undefined): PainelDia {
  const formasTot: Record<string, number> = {};
  const cartoesTot: Record<string, number> = {};
  const vistas = new Set<string>();
  let contas = 0, recebido = 0;
  vendas.filter((o) => o.status !== 'canceled').forEach((o) => {
    const methods = (o.payment_details as Pd)?.methods;
    if (!Array.isArray(methods) || methods.length === 0) return;
    const conta = `${o.table_id ?? o.id}|${JSON.stringify(methods)}`;
    if (vistas.has(conta)) return;
    vistas.add(conta);
    contas += 1;
    methods.forEach((m) => {
      const v = Number(m.amount) || 0;
      recebido += v;
      formasTot[m.method] = (formasTot[m.method] ?? 0) + v;
      if (m.brand && (m.method === 'CREDIT' || m.method === 'DEBIT')) { const k = `${m.method}|${m.brand}`; cartoesTot[k] = (cartoesTot[k] ?? 0) + v; }
    });
  });
  const base = montarPainel({ loja: '', periodoLabel: '', geradoEm: new Date(), geradoPor: '', turnos: [], vendas, excecoes: [] }, nomeCategoria);
  const sum = (pref: string) => Object.entries(cartoesTot).filter(([k]) => k.startsWith(pref)).reduce((s, [, v]) => s + v, 0);
  return {
    ...base,
    kpis: { ...base.kpis, contas, recebido, ticket: ticketMedio(recebido, contas), credito: sum('CREDIT|'), debito: sum('DEBIT|'), cancelamentos: vendas.filter((o) => o.status === 'canceled').length },
    formas: completarFormas(formasTot),
    cartoes: completarCartoes(cartoesTot),
  };
}
```
(importar `import type { Order } from '@/types'` no topo do arquivo.)

- [ ] **Step 4: Rodar e ver passar.**

- [ ] **Step 5: Menu "Relatório" no Histórico** — hoje a barra tem `Filtros`, `Imprimir`, `CSV` e `Zerar vendas`. Para **não aumentar a confusão de botões** (queixa do dono), `Imprimir` e `CSV` viram um único botão **"Relatório"** (mesmo `Button variant="secondary" size="sm"` e ícone `Printer` já usados) que abre um pequeno menu com três itens (mesmos tokens do app: `bg-[var(--surface)]`, `shadow-[var(--shadow-sm)]`, `rounded-[14px]`, `min-h-11` no celular):

1. **PDF / Imprimir** → `printRelatorioDia(montarPainelDeVendas(filteredAndSortedSales, nomeCat), { loja: store.name, periodoLabel, geradoEm: new Date(), geradoPor: loggedUser?.name ?? 'Equipe', titulo: 'Relatório de vendas' })`
2. **Excel** → `buildFechamentoWorkbook({ painel: montarPainelDeVendas(…), loja: store.name, periodoLabel, geradoEm: new Date(), geradoPor, turnos: [], vendas: filteredAndSortedSales, excecoes: [] })`, download com nome `relatorio-vendas_${hojeISO()}_${slug}.xlsx` (mesmo trecho Blob/`<a>` de `ReportsView.baixarFechamento`).
3. **Lista por venda (CSV)** → o `handleExportCsv` que já existe; e **Lista para imprimir** → o `handlePrintReport` (`printSalesReport`) que já existe, como segundo item "Lista para imprimir".

Estado: `const [menuRelatorio, setMenuRelatorio] = useState(false)`; fechar ao clicar fora (`useEffect` com `mousedown`) e com Esc. `nomeCat` vem de `fetchMenu(storeId, false, true)` carregado uma vez ao abrir o menu (`useRef` com o `Map`); se falhar, `() => undefined` (a categoria cai em "Sem categoria"/id é evitado porque `montarPainelDeVendas` usa o rótulo "Sem categoria" quando `nomeCategoria` não resolve — conferir no teste). O `periodoLabel` já existe nessa tela (usado por `handlePrintReport`).

- [ ] **Step 6: Rodar tudo.** Verificação manual em loja de teste: Histórico → "Relatório" → PDF / Imprimir mostra o painel das vendas filtradas; Excel baixa com Painel como 1ª aba e **sem** abas Caixa/Exceções.

- [ ] **Step 7: Commit** — `feat(relatorios): menu Relatório no Histórico de vendas (PDF, Excel, lista)`.

---

### Task 7: "Imprimir" em todos os relatórios

**Files:**
- Modify: `components/modules/ReportsView.tsx` (Análise do dia e Conferir turno), `components/modules/ExceptionsReportView.tsx`

**Interfaces:**
- Consumes: `printTabela` (Task 5).

- [ ] **Step 1: Análise do dia** — ao lado de "Ver análise", quando `linhas` existe e tem itens, botão `Button variant="secondary"` com `Printer`:

```tsx
  const imprimirAnalise = async () => {
    if (!linhas || linhas.length === 0) return;
    const rotuloCol = agrupar === 'hour' ? 'Hora' : agrupar === 'operator' ? 'Operador' : agrupar === 'method' ? 'Forma' : 'Categoria';
    const comContas = agrupar !== 'category';
    const ok = await printTabela({
      titulo: `Análise de vendas por ${rotuloCol.toLowerCase()}`,
      colunas: [{ rotulo: rotuloCol }, { rotulo: 'Total', direita: true }, ...(comContas ? [{ rotulo: 'Vendas', direita: true }, { rotulo: 'Ticket médio', direita: true }] : [])],
      linhas: linhas.map((r) => [r.label, `R$ ${formatBRL(r.total)}`, ...(comContas ? [String(r.orders), `R$ ${formatBRL(r.ticket)}`] : [])]),
      rodapeLinha: ['TOTAL', `R$ ${formatBRL(linhas.reduce((s, r) => s + r.total, 0))}`, ...(comContas ? [String(linhas.reduce((s, r) => s + r.orders, 0)), ''] : [])],
    }, { loja: storeName, periodoLabel: new Date(`${dia}T12:00:00-03:00`).toLocaleDateString('pt-BR'), geradoEm: new Date(), geradoPor: userName });
    if (!ok) toast.error('Não consegui abrir a impressão.');
  };
```

- [ ] **Step 2: Conferir turno** — com `turnoAberto` aberto, botão "Imprimir turno" que chama `printTabela` com as formas (`completarFormas`), depois os cartões (`completarCartoes`), título `Turno de ${operador}`, colunas Forma/Total, mais linhas "Contas pagas", "Total" e "Ticket médio" no topo (`ticketMedio`), usando a mesma `meta`.

- [ ] **Step 3: Exceções** — em `ExceptionsReportView.tsx`, ao lado do seletor de período (mesmo `Button variant="secondary"`), "Imprimir":

```tsx
  const imprimir = async () => {
    const ok = await printTabela({
      titulo: 'Exceções por operador',
      subtitulo: periodo === 'hoje' ? 'Hoje' : periodo === '7d' ? 'Últimos 7 dias' : 'Últimos 30 dias',
      colunas: [{ rotulo: 'Data' }, { rotulo: 'Operador' }, { rotulo: 'Tipo' }, { rotulo: 'Detalhe' }, { rotulo: 'Valor', direita: true }],
      linhas: eventos.map((e) => { const d = e.details as Record<string, unknown>; return [hora(e.created_at), e.operator_name, EXCEPTION_LABELS[e.event_type] ?? e.event_type, `${String(d.produto ?? '')}${d.motivo ? ` — ${String(d.motivo)}` : ''}`, `R$ ${formatBRL(Number(d.valor ?? 0))}`]; }),
    }, { loja: storeName, periodoLabel: new Date().toLocaleDateString('pt-BR'), geradoEm: new Date(), geradoPor: userName });
    if (!ok) toast.error('Não consegui abrir a impressão.');
  };
```
A view hoje recebe só `storeId`; acrescentar as props `storeName: string; userName: string` e atualizar a chamada em `StoreModule.tsx` (`<ExceptionsReportView storeId={storeId} storeName={store.name} userName={loggedUser.name} />`), mais os imports (`printTabela`, `toast`, `Printer`, `Button`).

- [ ] **Step 4: Rodar tudo.** Verificação manual em loja de teste: cada botão abre a janela de impressão com cabeçalho Norte e rodapé pequeno.

- [ ] **Step 5: Commit** — `feat(relatorios): imprimir análise, turno e exceções com o mesmo cabeçalho do Norte`.

---

### Task 8 (opcional, isolada): Período em intervalo (semana / mês)

**Files:**
- Modify: `lib/reports/dia.ts`, `lib/reports/carregarFechamento.ts`, `components/modules/ReportsView.tsx`
- Create: `scripts/testes/periodo.test.ts`

Só fazer se o dono confirmar que quer intervalo agora. **Risco:** `fetchCashShiftsHistory(storeId, 200)` limita a 200 turnos e `fetchSalesHistory` pode ser pesado para um mês; por isso o teto de 31 dias e a mensagem de aviso. Não muda o cálculo do caixa (soma os resumos de cada turno, como o dia).

**Interfaces:**
- Produces: `limitesDoPeriodo(de: string, ate: string): [Date, Date]` (início do dia `de`, fim do dia `ate`; lança `Error('periodo-invalido')` se `ate < de` ou mais de 31 dias); `rotuloPeriodo(de, ate): string` (`'04/10/2026'` se iguais, senão `'01/10/2026 a 31/10/2026'`).

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/periodo.test.ts
import assert from 'node:assert/strict';
import { limitesDoPeriodo, rotuloPeriodo } from '../../lib/reports/dia';
const [ini, fim] = limitesDoPeriodo('2026-10-01', '2026-10-31');
assert.equal(ini.toISOString(), '2026-10-01T03:00:00.000Z');
assert.equal(fim.toISOString(), '2026-11-01T02:59:59.999Z');
assert.throws(() => limitesDoPeriodo('2026-10-05', '2026-10-01'), /periodo-invalido/);
assert.throws(() => limitesDoPeriodo('2026-09-01', '2026-10-31'), /periodo-invalido/, 'mais de 31 dias');
assert.equal(rotuloPeriodo('2026-10-04', '2026-10-04'), '04/10/2026');
assert.equal(rotuloPeriodo('2026-10-01', '2026-10-07'), '01/10/2026 a 07/10/2026');
console.log('periodo: ok');
```

- [ ] **Step 2: Implementação** (em `dia.ts`)

```ts
export function limitesDoPeriodo(de: string, ate: string): [Date, Date] {
  const [ini] = limitesDoDia(de);
  const [, fim] = limitesDoDia(ate);
  const dias = (fim.getTime() - ini.getTime()) / 86_400_000;
  if (!(fim > ini) || dias > 31) throw new Error('periodo-invalido');
  return [ini, fim];
}
export const rotuloPeriodo = (de: string, ate: string): string => {
  const f = (d: string) => new Date(`${d}T12:00:00-03:00`).toLocaleDateString('pt-BR');
  return de === ate ? f(de) : `${f(de)} a ${f(ate)}`;
};
```
`carregarFechamento` passa a receber `de` e `ate` (o parâmetro `dia` vira `de = ate = dia` para quem ainda manda um dia só) e usa `limitesDoPeriodo`.

- [ ] **Step 3: UI** — no cartão "Fechamento do dia" acrescentar um segundo `Input type="date"` ("Até", `min={dia}`, `max={hojeISO()}`), vazio = só o dia. Mesmos componentes de hoje. Erro `periodo-invalido` → `toast.error('Escolha no máximo 31 dias.')`.

- [ ] **Step 4: Rodar tudo e commitar** — `feat(relatorios): fechamento por intervalo de datas (até 31 dias)`.

---

### Task 9: QA completo e limpeza

**Files:** nenhum arquivo do app.

- [ ] **Step 1: Gerar os três arquivos com dados sintéticos e olhar** (sem tocar em loja real):

```bash
SP=/private/tmp/claude-501/-Users-joaquimsalles/c6bc8184-59d3-420a-a93b-f78ddbc44bd9/scratchpad/rel
cd $SP && npx tsx gerar.ts $SP/final.xlsx
soffice --headless --norestore -env:UserInstallation=file:///tmp/lo_prof_rel --convert-to pdf --outdir $SP $SP/final.xlsx
pdftoppm -r 80 -png $SP/final.pdf $SP/xl
```
Abrir `xl-1.png` (Painel) e uma página de cada aba de detalhe (Caixa, Vendas): fonte única, faixa azul `#484DB5`, cartões alinhados, barras visíveis, sem `####`, rodapé único.

- [ ] **Step 2: Renderizar o PDF do relatório HTML** com Chrome headless (já presente no Mac) a partir de um HTML gerado pelo `buildRelatorioHtml` com os mesmos dados:

```bash
cd $SP && cat > html.ts <<'EOF'
import { writeFileSync } from 'node:fs';
import { montarPainel } from '/Users/joaquimsalles/Projects/norte para negocios/ntb vendas/lib/reports/painelDia';
import { buildRelatorioHtml, RELATORIO_STYLES } from '/Users/joaquimsalles/Projects/norte para negocios/ntb vendas/lib/reports/relatorioHtml';
// reutilizar o mesmo objeto de dados de gerar.ts (copiar o literal para cá) e:
// const painel = montarPainel(dados, dados.nomeCategoria);
// writeFileSync(process.argv[2], `<!doctype html><meta charset="utf-8"><style>${RELATORIO_STYLES}</style>${buildRelatorioHtml(painel, dados)}`);
EOF
```
(copiar o literal `dados` de `gerar.ts`, descomentar as duas últimas linhas) e depois
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --print-to-pdf=$SP/relatorio.pdf --no-pdf-header-footer file://$SP/relatorio.html && pdftoppm -r 80 -png $SP/relatorio.pdf $SP/pdf`. Conferir: uma página A4 para o dia sintético, símbolo do Norte visível no topo, barras, bandeiras zeradas em cinza, propaganda pequena no rodapé.

- [ ] **Step 3: Teste real na tela, loja de TESTE** (Donana ou ZZ Laboratório; **nunca** o Sertão): abrir Administração → Relatórios, baixar o Excel de hoje e abrir; clicar "PDF / Imprimir" (cancelar a impressão); Histórico → Relatório → PDF e Excel; Exceções → Imprimir. Só leitura: nenhum pedido, nota ou dado de loja é criado.

- [ ] **Step 4: Limpeza** — `rm -rf $SP/*.png $SP/*.pdf $SP/*.xlsx $SP/*.html` (manter só `gerar.ts` até o fim da sessão), apagar `~/ClaudeGerado/relatorios-teste/` se criado e qualquer download de teste da pasta Downloads; `git status` sem arquivos soltos.

- [ ] **Step 5: Rodar tudo e fechar** — comando padrão; `git log --oneline -10` mostra os commits das Tasks 1–7 (e 8 se feita). Deploy fica para o lote com a loja fechada.

---

## Self-review

- **Cobertura do pedido:** cores do Norte e visual novo só nos arquivos (T1, T4); propaganda pequena (rodapé `NORTE_RODAPE` e `RODAPE`); total por cartão com crédito/débito por bandeira (T1, T4, T6); análises por hora/operador/categoria + produtos mais vendidos + ticket médio + KPIs (T1, T4); PDF **ou** Excel (T5, T6); imprimir todos os relatórios (T5, T7); intervalo semana/mês (T8, opcional).
- **Restrição do coordenador (identidade visual):** só `Button`/`Card`/`Input` e tokens existentes nas telas; menu do Histórico usa os mesmos tokens; nenhum redesign de tela (Global Constraints).
- **Placeholders:** nenhum nas bibliotecas; as edições de tela estão como código ou como trecho exato a trocar. O ponto que depende do estado local da tela (variável `periodoLabel`, `loggedUser`) está nomeado conforme o arquivo lido.
- **Tipos:** `PainelDia`, `FechamentoData.painel`, `RelatorioMeta`, `printRelatorioDia`, `printTabela`, `limitesDoDia`/`limitesDoPeriodo`, `carregarFechamento` usados com os mesmos nomes em todas as tasks. `FechamentoData` serve de `RelatorioMeta` (tem `loja`, `periodoLabel`, `geradoEm`, `geradoPor`).
- **Review Focus:** 1 → T1/T2; 2 → T1/T4; 3 → T1/T4; 4 → T2; 5 → T6; 6 → T1/T4.
