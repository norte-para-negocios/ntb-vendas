# Relatórios v2 (gráficos + Equipe por login) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a aba Relatórios ficar melhor que o Resumo: muito mais gráficos e dados, e uma aba Equipe que mostra por login o que cada pessoa fez (lançou, recebeu, cancelou, entrou/saiu, pré-contas, trocas de mesa), com PDF.

**Architecture:** O painel atual (`RelatoriosPainel.tsx`, uma rolagem só) vira 4 abas (Visão geral · Produtos · Equipe · Contas) com filtros e período em comum. Contas novas ficam puras e testadas em `lib/reports/` (`analiseVendas.ts` ganha mapa de calor, mesa×balcão, ticket por dia; `analiseEquipe.ts` novo junta 4 fontes por pessoa). Uma RPC nova só de leitura (migração 189) entrega os eventos do app gravados em `staff_audit_log` (logins, pré-contas, trocas de mesa, pedir conta).

**Tech Stack:** Next.js 16, React, Recharts (já usado no Resumo), Supabase self-hosted (Postgres), testes `npx tsx scripts/testes/*.test.ts` com `node:assert/strict`.

**Spec:** pedido do dono em 26/10/2026 (conversa): "tá uma merda esses relatórios… mais gráficos, tipo na tela de resumo (resumo tá melhor que a de relatórios), mais coisas, mais dados, ver por login o que cada pessoa fez, o que cada pessoa lançou etc." + plano anterior `docs/superpowers/plans/2026-10-25-relatorios-completos.md`.

## Global Constraints

- Evoluir o design atual: nada do painel de 25/10 some (período, filtros, PDF completo, PDF por seção, Excel, clique abre lista de contas, "Arquivos e conferência de caixa" embaixo).
- Gráficos com Recharts e tokens de cor (`var(--brand)`, `--ok`, `--info`, `--warn`, `--err`, `--text-muted`), mesma paleta `COLORS` do Resumo.
- Fuso das contas: `America/Bahia`.
- Conta 100% cortesia nunca é venda; taxa e item cancelado nunca são produto vendido (regras de `analiseVendas.ts` valem para tudo).
- Funciona em 390 px sem rolagem horizontal da página.
- Texto em PT-BR, nome do produto "Norte Vendas".
- `next dev` local SEMPRE com `DISABLE_FISCAL_RETRANSMISSAO=1 DISABLE_BAIXA_RETRY=1`; prévia em página temporária não commitada.
- Portão (`scripts/e2e/portao-deploy.sh`) antes de push/deploy; deploy e release só de madrugada; atualização dos apps opcional.

## Review Focus

- Mesma pessoa com nomes diferentes nas fontes ("Herica" no login, "Herica Santos Uchoa Lacerda" no item) → juntar quando um nome normalizado é o primeiro nome único do outro; nunca juntar dois nomes completos diferentes.
- Login sem saída (app fechado) → tempo logado conta até o próximo "entrou" da mesma pessoa, o último lançamento dela ou no máximo 12 h, nunca passa do fim do período.
- Lojas no Modo Aberto: ator "Mesas" (aparelho) não é pessoa; quem lançou é `added_by_name`. "Mesas" e "(sem login)" aparecem só como aparelho, fora do ranking da equipe.
- Período sem eventos de auditoria (RPC falhou ou loja antiga) → aba Equipe mostra vendas/recebimentos normalmente e avisa "atividade de login indisponível", não quebra.
- Período longo (30–366 dias) → mapa de calor e linha do tempo continuam rápidos: linha do tempo pagina (50 por vez), RPC limitada a 5000 eventos com aviso quando cortar.

---

### Task 1: RPC de atividade da equipe (migração 189)

**Files:**
- Create: `supabase/migrations/189_atividade_equipe.sql`
- Modify: `lib/api.ts` (junto de `fetchExceptionsReport`, ~l.1896)

**Interfaces:**
- Produces: RPC `fetch_atividade_equipe_secure(p_store_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb` = `{ eventos: [{quando, quem, papel, acao, resumo, detalhe}], cortado: boolean }`, só `origin='app'` mais `table_sessions.insert` (vira `acao='mesa.abriu'`) com ator ≠ '(sem login)'; ordem crescente; limite 5000.
- Produces: `fetchAtividadeEquipe(storeId: string, de: Date, ate: Date): Promise<AtividadeEquipe | null>` (null = falhou) e `type EventoAtividade = { quando: string; quem: string; papel: string | null; acao: string; resumo: string | null; detalhe: Record<string, unknown> }`, `type AtividadeEquipe = { eventos: EventoAtividade[]; cortado: boolean }` exportados de `lib/reports/analiseEquipe.ts` (Task 2 cria o arquivo; Task 1 cria só os tipos nele).

- [ ] Step 1: Escrever a migração (security definer, `set search_path = public`, `grant execute … to anon, authenticated`, mesmo padrão de `fetch_exceptions_report_secure`; `detalhe` = `details` sem `linha`/`mudou`).
- [ ] Step 2: Aplicar no banco de produção (`docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas < 189…`) + `NOTIFY pgrst, 'reload schema'`. É só leitura e aditiva, pode ir de dia.
- [ ] Step 3: Conferir: `select jsonb_array_length(fetch_atividade_equipe_secure('e73782c1-…', now()-interval '7 days', now())->'eventos')` > 0 e as ações vistas incluem `login.entrou`, `reimpressao.pre_conta`.
- [ ] Step 4: `fetchAtividadeEquipe` em `lib/api.ts`.
- [ ] Step 5: Commit `feat(relatórios): RPC de atividade da equipe (189)`.

### Task 2: Análise por pessoa (`lib/reports/analiseEquipe.ts`)

**Files:**
- Create: `lib/reports/analiseEquipe.ts`
- Test: `scripts/testes/analiseEquipe.test.ts`

**Interfaces:**
- Consumes: `quemLancou`, `chaveDoProduto` de `analiseVendas.ts`; `valorFaturado`, `metodosDoPagamento`, `CORTESIA` de `lib/faturamento`; `ExceptionsReport` de `lib/excecoes`; `OperatorCheckin` de `@/types`.
- Produces:
  - `normalizarNome(n: string): string` (trim, minúsculas, sem acento, espaços únicos).
  - `type Pessoa = { nome: string; papel: string | null; lancou: { itens: number; valor: number; contas: number; mesas: number; porHora: number[] /*24*/; produtos: { nome: string; qtd: number; total: number }[]; categorias: { nome: string; total: number }[] }; recebeu: { contas: number; valor: number; porForma: { chave: string; rotulo: string; total: number }[] }; excecoes: { total: number; cancelados: { qtd: number; valor: number }; porTipo: Record<string, number> }; login: { entradas: number; minutos: number; primeiro: string | null; ultimo: string | null }; preContas: number; mesasTrocadas: number; mesasAbertas: number; ponto: { minutos: number } }`
  - `analisarEquipe(e: { vendas: Order[]; categorias: { id: string; name: string }[]; atividade: AtividadeEquipe | null; excecoes: ExceptionsReport | null; checkins: OperatorCheckin[]; fimPeriodo: string }): { pessoas: Pessoa[]; aparelhos: { nome: string; eventos: number }[] }` — ordenado por `lancou.valor + recebeu.valor` desc.
  - `type EventoLinha = { quando: string; tipo: 'login' | 'logout' | 'lancou' | 'recebeu' | 'cancelou' | 'pre_conta' | 'mesa' | 'ponto' | 'outro'; texto: string; valor?: number }`
  - `linhaDoTempo(nome: string, mesmas fontes de analisarEquipe): EventoLinha[]` — mais recente primeiro; lançamentos do mesmo pedido no mesmo minuto viram uma linha ("Lançou 3 itens · Mesa 12").

- [ ] Step 1: Testes (dados de exemplo no estilo de `analiseVendas.test.ts`):
  - `Herica` (login) e `Herica Santos Uchoa Lacerda` (item/operador) viram uma pessoa; `Ana Souza` e `Ana Lima` continuam duas.
  - Itens lançados por Talislane somam `lancou.valor`; conta com `operador_nome: 'Herica'` soma em `recebeu` por forma; conta 100% cortesia não entra em `recebeu.valor`; item cancelado não entra em `lancou`.
  - `login.entrou` 10:00 → `login.saiu` 12:30 = 150 min; `entrou` sem saída com fim do período 4 h depois = 240 min; sem saída e período de 2 dias = no máximo 720 min.
  - Ator `Mesas` (papel `open`) vai para `aparelhos`, não para `pessoas`.
  - `atividade: null` → pessoas só com vendas, `login.entradas === 0`, sem erro.
  - `linhaDoTempo('Talislane', …)` agrupa 3 itens do mesmo pedido no mesmo minuto numa linha `tipo:'lancou'` com `valor` somado.
- [ ] Step 2: Rodar `npx tsx scripts/testes/analiseEquipe.test.ts` → falha (módulo não existe).
- [ ] Step 3: Implementar. Junção de nomes: chave = `normalizarNome`; depois, cada nome de uma palavra é ligado ao único nome completo cujo primeiro nome bate (se houver mais de um, fica separado). Papel = o mais frequente visto nas fontes.
- [ ] Step 4: Testes passam.
- [ ] Step 5: Commit `feat(relatórios): análise por pessoa (lançou, recebeu, exceções, logins)`.

### Task 3: Mais dados em `analiseVendas.ts`

**Files:**
- Modify: `lib/reports/analiseVendas.ts`
- Test: `scripts/testes/analiseVendas.test.ts`

**Interfaces:**
- Produces (campos novos em `Analise`): `mapaCalor: number[][]` (7×24, total por dia da semana × hora), `porTipo: { mesa: { total: number; contas: number }; balcao: { total: number; contas: number } }`, `porDia[i].ticket: number`, `kpis.mesasAtendidas: number` (rótulos de mesa distintos), `kpis.maiorConta: number`, `kpis.horaPico: number | null`, `kpis.diaPico: string | null`.
- Produces: `serieComparada(atual: { dia: string; total: number }[], anterior: { dia: string; total: number }[]): { rotulo: string; atual: number; anterior: number | null }[]` (alinha pela posição; rótulo `dd/mm` do atual).

- [ ] Step 1: Testes com as `vendas` já existentes: `mapaCalor[6][13] === 154` (sábado 24/10 13h), `porTipo.balcao.total === 10`, `kpis.mesasAtendidas === 1`, `kpis.maiorConta === 154`, `kpis.horaPico === 13`, `porDia[0].ticket === 154`; `serieComparada` com anterior mais curto devolve `anterior: null` no que faltar.
- [ ] Step 2: Rodar → falha.
- [ ] Step 3: Implementar.
- [ ] Step 4: Rodar todos os testes de `scripts/testes/` de relatórios → passam.
- [ ] Step 5: Commit `feat(relatórios): mapa de calor, mesa×balcão, picos e série comparada`.

### Task 4: Gráficos e abas (Visão geral, Produtos, Contas)

**Files:**
- Create: `components/modules/relatorios/graficos.tsx` — `KpiHero` (valor, variação, sparkline SVG como no Resumo), `AreaComparada` (área atual + linha tracejada do período anterior), `Rosca` (donut com legenda clicável), `BarrasHorizontais` (top N clicável), `MapaCalor` (7×24, intensidade de `--brand`, toque abre contas daquela hora), `COLORS`.
- Create: `components/modules/relatorios/AbaVisaoGeral.tsx`, `AbaProdutos.tsx`, `AbaContas.tsx`
- Modify: `components/modules/relatorios/RelatoriosPainel.tsx` (fica: carregar, período, filtros, abas, PDF/Excel, lista de detalhe)

**Interfaces:**
- Consumes: `Analise` (Task 3), `serieComparada`, `Recorte`, `contasDoRecorte`.
- Produces: props comuns das abas `{ analise: Analise; analiseAnt: Analise | null; umDia: boolean; abrirLista: (titulo: string, r: Recorte) => void; pdf: (secoes?: SecaoRelatorio[], titulo?: string) => void }`.

Conteúdo:
- Visão geral: 8 KpiHero (faturamento, contas, ticket, itens, taxa, cortesias, mesas atendidas, maior conta; sparkline por dia) → AreaComparada (por hora num dia, por dia no período, vs. anterior) → linha Ticket médio por dia (só períodos) → Rosca formas + Rosca categorias + Rosca mesa×balcão → MapaCalor (só períodos ≥ 2 dias; num dia, barras por hora) → BarrasHorizontais top 10 produtos e top 5 pessoas (clicar pessoa abre aba Equipe nela) → cartões "Pico": melhor dia, melhor hora, dia da semana mais forte.
- Produtos: o bloco atual (abas mais/menos/valor, busca, ver todos) + BarrasHorizontais por categoria + Rosca de categoria.
- Contas: lista atual + ordenar por valor/hora + busca por mesa/forma/quem fechou.

- [ ] Step 1: Escrever os componentes; `npx tsc --noEmit` sem erro novo.
- [ ] Step 2: Prévia local com dados reais da ODARA (página temporária, variáveis de desligar ciclos) em 1440 e 390 px; screenshot de cada aba; clicar rosca/barra/mapa abre a lista certa.
- [ ] Step 3: Commit `feat(relatórios): abas e gráficos (visão geral, produtos, contas)`.

### Task 5: Aba Equipe + Pessoa + PDF

**Files:**
- Create: `components/modules/relatorios/AbaEquipe.tsx`, `components/modules/relatorios/PessoaDetalhe.tsx`
- Modify: `lib/reports/relatorioCompletoHtml.ts` (seção `equipe` com colunas novas; `buildPessoaHtml(p: Pessoa, linha: EventoLinha[], meta)`), `lib/print.ts` (`printPessoa`), `RelatoriosPainel.tsx` (carregar atividade, exceções e ponto do período junto das vendas)
- Test: `scripts/testes/relatorioCompletoHtml.test.ts`

**Interfaces:**
- Consumes: `analisarEquipe`, `linhaDoTempo`, `Pessoa`, `EventoLinha` (Task 2); `fetchAtividadeEquipe` (Task 1); `fetchExceptionsReport`, `fetchCheckinsHistory` (já existem).

Conteúdo:
- AbaEquipe: gráfico de barras agrupadas (lançou × recebeu por pessoa) → cartões por pessoa (inicial, nome, função, lançou R$/itens, recebeu R$/contas, cancelou, tempo logado, pré-contas, mini-gráfico por hora) → "Aparelhos" (Mesas, sem login) discreto embaixo → aviso se atividade indisponível/cortada.
- PessoaDetalhe (folha lateral no PC, tela cheia no celular): KPIs da pessoa, barras por hora, produtos que lançou, categorias, contas recebidas por forma (rosca), exceções por tipo, linha do tempo paginada (50 por vez) com filtro por tipo, botões "Ver contas" (abre lista do recorte `pessoa`) e "PDF desta pessoa".

- [ ] Step 1: Teste: `buildPessoaHtml` contém nome, "Lançou", "Recebeu", tempo logado formatado ("2h30") e as linhas da linha do tempo; seção `equipe` do relatório completo tem coluna "Recebeu".
- [ ] Step 2: Rodar → falha. Step 3: implementar. Step 4: passa.
- [ ] Step 5: Prévia com ODARA (Herica, Talislane, Tai…) em 1440/390; screenshot da aba e de uma pessoa; PDF da pessoa abre.
- [ ] Step 6: Commit `feat(relatórios): aba Equipe com o que cada login fez + PDF por pessoa`.

### Task 6: Revisão, portão, publicação de madrugada

- [ ] Step 1: Revisor independente (1 agente) no diff da branch contra este plano; corrigir achados.
- [ ] Step 2: Todos os testes de `scripts/testes/` passam; `npx tsc --noEmit`; `npm run build`.
- [ ] Step 3: Mandar screenshots ao dono.
- [ ] Step 4: De madrugada, sem movimento: portão → merge na main → `deploy.sh` → `scripts/release-apps.sh` (versões seguintes, opcional).
- [ ] Step 5: Atualizar memória do projeto.

### Task 7: Vídeo novo (depois de no ar)

- [ ] Step 1: Roteiro curto (~60–75 s): abrir Relatórios → período → Visão geral (gráficos) → Equipe → abrir uma pessoa → PDF → mandar ao sócio. Zoom suave na área de cada passo, cursor visível, legenda grande, sem cartões longos.
- [ ] Step 2: Gravar com a Casa Norte (demo) depois do deploy, revisar quadro a quadro, mandar ao dono (ao Ramon só com "manda").
