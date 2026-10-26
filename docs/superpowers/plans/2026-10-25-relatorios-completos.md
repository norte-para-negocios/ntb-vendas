# Relatórios completos (Norte Vendas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a aba Relatórios num painel completo: qualquer período, filtros (categoria/grupo, operador, forma, mesa/balcão), indicadores com comparação, gráficos, ranking de produtos e categorias, equipe, formas de pagamento, mesas e lista de contas — tudo clicável até a venda, com PDF de cada seção e PDF completo.

**Architecture:** Dados = `fetch_sales_history_secure` buscado em pedaços de 1 dia (a RPC corta em 2000 pedidos) e juntado por conta (`agruparPorConta`). Toda a conta é feita numa função pura (`analisarVendas`) testada; a tela só desenha. PDF reaproveita `printHtmlDocument` + `RELATORIO_STYLES`. Os 3 cartões atuais (fechamento Excel/PDF, análise do dia, conferir turno) ficam embaixo, sem mudança.

**Tech Stack:** Next.js 16 / React, TypeScript, recharts (já usado no Resumo), testes `npx tsx scripts/testes/*.test.ts`.

**Spec:** pedido do dono 25/10/2026 (este plano): "ver os produtos que mais vendo, filtrar por categoria, clicar e ver todas as listas, baixar PDF de tudo, dashboard completo e bonito".

## Global Constraints
- Manter o visual atual do painel (Card, tokens `--brand`, `--surface`, `eyebrow`); evoluir, não redesenhar. Não remover nenhum controle existente.
- Valor de venda = `valorFaturado` (lib/faturamento.ts): sem cortesia; conta = `chaveContaPaga`.
- Fuso America/Bahia em todo dia/hora (`localDayAndMinutes`, lib/priceSchedule.ts).
- Nome de item = `getOrderItemDisplayName` (lib/labels.ts); categoria por `product.category_id`.
- Textos em PT-BR, sem travessão em rótulos de produto.
- Período máximo 366 dias; busca em paralelo de no máximo 6 dias por vez.

## Review Focus
- Período sem venda nenhuma: todas as seções mostram "Nada neste período", PDF sai com o aviso, sem erro.
- Dia com mais de 2000 pedidos (busca por dia ainda corta): avisar "Dados podem estar incompletos em DD/MM" quando um dia vier com exatamente 2000.
- Item cancelado e conta 100% cortesia: fora do faturamento e do ranking; cancelados contam só em "Cancelados".
- Produto apagado do cardápio / sem categoria: aparece como "Sem categoria" e com o nome gravado.
- Troca de filtro enquanto carrega: resposta antiga não sobrescreve a nova (token de requisição).

---

### Task 1: Período (presets e comparação)
**Files:** Create `lib/reports/periodo.ts`; Test `scripts/testes/periodo.test.ts`
**Interfaces — Produces:**
- `type PresetPeriodo = 'hoje'|'ontem'|'7d'|'30d'|'mes'|'mes_passado'|'personalizado'`
- `periodoDoPreset(p: PresetPeriodo, agora: Date, de?: string, ate?: string): { de: string; ate: string; rotulo: string }` (datas `YYYY-MM-DD` no fuso da Bahia)
- `periodoAnterior(de: string, ate: string): { de: string; ate: string }` (mesmo número de dias, imediatamente antes)
- `diasDoPeriodo(de: string, ate: string): string[]` (máx. 366; lança se ate < de)
- [ ] Teste: hoje/ontem/7d/30d/mês/mês passado para agora=2026-10-25T03:30Z (ainda 24/10 na Bahia → hoje='2026-10-24'); `periodoAnterior('2026-10-01','2026-10-07')` = 24/09–30/09; `diasDoPeriodo` 3 dias; erro para ate<de.
- [ ] Implementar; rodar; commit.

### Task 2: Carregar vendas do período em pedaços
**Files:** Create `lib/reports/carregarVendasPeriodo.ts`; Test `scripts/testes/carregarVendasPeriodo.test.ts`
**Interfaces — Consumes:** `diasDoPeriodo`. **Produces:** `carregarVendasPeriodo(buscarDia: (iniIso: string, fimIso: string) => Promise<Order[]>, de: string, ate: string): Promise<{ vendas: Order[]; diasCortados: string[] }>` — busca cada dia (limites do dia via `limitesDoDia` de lib/reports/dia.ts), 6 em paralelo, remove id repetido, `agruparPorConta`; `diasCortados` = dias que vieram com 2000 pedidos.
- [ ] Teste com `buscarDia` falso: 3 dias, pedido repetido entre dias aparece 1x; dia com 2000 vai para `diasCortados`; no máximo 6 chamadas simultâneas.
- [ ] Implementar; rodar; commit.

### Task 3: Análise completa (função pura)
**Files:** Create `lib/reports/analiseVendas.ts`; Test `scripts/testes/analiseVendas.test.ts`
**Interfaces — Produces:**
- `type FiltrosRelatorio = { categoria: FiltroCategoria; operador: string | null; forma: string | null; tipo: 'todos'|'mesa'|'balcao' }` (`FiltroCategoria` de lib/rankingProdutos.ts)
- `analisarVendas(vendas: Order[], categorias: {id,name,group_id?}[], filtros: FiltrosRelatorio): Analise`
- `Analise = { kpis: { faturamento, contas, ticket, itens, taxaServico, cortesia, cancelados: {qtd,valor} }, porDia: {dia, total, contas}[], porHora: {hora, total, contas}[], porDiaSemana: {dia: 0-6, total}[], produtos: LinhaProduto[], categorias: {id, nome, qtd, total, pct}[], formas: {chave, rotulo, total, contas}[], equipe: {nome, itens, total}[], mesas: {rotulo, contas, total, ticket}[], contas: ContaResumo[] }`
- `LinhaProduto = { chave, nome, categoriaId, categoria, qtd, total, contas }`; `ContaResumo = { id, quando, local, operador, formas: string, total, itens: {nome, qtd, total}[] }`
- `vendasDoProduto(vendas, chave)`, `vendasDaCategoria(vendas, id)` → `ContaResumo[]` (para os cliques)
- Regras: filtro de categoria/produto age nos itens e o faturamento da seção Produtos/Categorias é soma dos itens; KPIs com filtro de categoria = soma dos itens filtrados; operador = `payment_details.operador_nome` da conta ou `added_by_name` do item; forma = método do pagamento.
- [ ] Testes (fixture de 4 contas, 1 cortesia, 1 item cancelado, 1 balcão): KPIs exatos, ranking ordenado por qtd e por total, categoria "Sem categoria", filtro de categoria, filtro de forma, filtro balcão, cancelados fora do ranking, `vendasDoProduto` lista só contas com o produto, período vazio = tudo zerado e listas vazias.
- [ ] Implementar; rodar; commit.

### Task 4: PDF completo e por seção
**Files:** Create `lib/reports/relatorioCompletoHtml.ts`; Modify `lib/print.ts` (exportar `printRelatorioCompleto`); Test `scripts/testes/relatorioCompletoHtml.test.ts`
**Interfaces — Consumes:** `Analise`, `RelatorioMeta`, `RELATORIO_STYLES`, `esc`. **Produces:** `type SecaoRelatorio = 'resumo'|'dias'|'produtos'|'categorias'|'formas'|'equipe'|'mesas'|'contas'`; `buildRelatorioCompletoHtml(a: Analise, m: RelatorioMeta, secoes: SecaoRelatorio[]): string`; `printRelatorioCompleto(a, m, secoes): Promise<boolean>` (via `printHtmlDocument`).
- [ ] Teste: HTML contém cada título de seção pedida e nenhuma não pedida; valores formatados `R$ 1.234,50`; período vazio mostra "Nada para mostrar neste período."; nomes escapados (`<b>` vira `&lt;b&gt;`).
- [ ] Implementar; rodar; commit.

### Task 5: Painel na tela
**Files:** Create `components/modules/relatorios/RelatoriosPainel.tsx` (filtros, KPIs, gráficos, seções), `components/modules/relatorios/ListaDetalhe.tsx` (gaveta com a lista clicada + PDF da lista); Modify `components/modules/ReportsView.tsx` (painel no topo; cartões atuais embaixo sob "Arquivos e conferência de caixa"); Create `app/dev/relatorios/page.tsx` (só `NODE_ENV==='development'`, `notFound()` em produção, para captura com loja real).
**Interfaces — Consumes:** Tasks 1-4, `fetchSalesHistory`, `fetchMenu`, recharts.
- Topo: chips de período + datas; filtros (categoria/grupo via `opcoesDoFiltro`, operador, forma, mesa/balcão); botões "PDF completo" e "Excel" (`buildFechamentoWorkbook` com as vendas).
- KPIs com variação % contra `periodoAnterior` (verde/vermelho, "–" sem base).
- Gráfico de faturamento por dia (1 dia = por hora); clicar num dia filtra só aquele dia.
- Seções: Produtos (abas Mais vendidos / Menos vendidos / Por faturamento, busca, top 15 + "Ver todos"), Categorias (barra %), Formas de pagamento, Equipe, Mesas/Balcão, Contas (busca). Cada linha abre `ListaDetalhe` com as contas; cada seção tem botão PDF.
- Aviso de dias cortados (Task 2).
- [ ] tsc limpo; testes; captura em `/dev/relatorios?loja=<id ODARA>` em 1440px e 390px sem corte; commit.

### Task 6: Publicar
- [ ] Push na main, `deploy.sh`, 200 em /loja; memória atualizada.
