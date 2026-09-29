# Melhorias do Sertão pós-virada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Entregar o pacote de pedidos do Ramon/dono feitos em 29/09 (onde cada documento imprime, fechamento de caixa impresso, hora do pedido, baixa por local, comanda legível, cancelamentos certos) SEM publicar nada em produção até o dono liberar.

**Architecture:** Cada impressora ganha uma lista de "documentos" que ela recebe (comanda, pré-conta, comprovante, cupom fiscal, fechamento de caixa); a fila de impressão filtra por isso. O resto são mudanças pontuais em `lib/print.ts`, `StoreModule.tsx` e no Estoque (config de local de baixa já existe).

**Tech Stack:** Next.js 16 / TypeScript, Supabase self-hosted (Contabo, banco `ntb_vendas`), Electron (desktop), testes com `npx tsx scripts/testes/*.test.ts`.

**Spec:** Áudios do Ramon (WhatsApp, 29/09 18:53–19:26) + pedidos do dono na conversa. Resumo: fonte maior/alinhamento da comanda; cancelamento de pizza na impressora da pizzaria; pré-conta no bar (configurável por loja); "separar comanda de nota fiscal" e configurar onde imprime cada coisa; relatório de fechamento de caixa (modelo "POSIÇÃO DO CAIXA"); hora do pedido na comanda; baixa de estoque no local Bar; marca "Veio do Norte Vendas" nas OPs; botão de cancelar pedido de conta (caixa/gerente).

## Global Constraints

- **NÃO PUBLICAR NADA** (deploy web, release desktop/Android, deploy do Estoque) — o Ramon pediu "não sobe nada hoje; mexer só com o sistema parado". Publicar só quando o dono mandar.
- Migrations novas podem ser aplicadas no Contabo **somente se aditivas** (função/coluna nova com default) e sem mudar comportamento dos apps atuais. Nunca alterar dado de produção do Sertão nesta fase, exceto o passo marcado "JANELA" (Task 5).
- Material voltado ao cliente diz "Norte Vendas", nunca "NTB Vendas".
- Nada de credencial enviada/gravada (o pedido de senha do contábil é do dono, fora deste plano).
- Testes: `npx tsx scripts/testes/<arquivo>.test.ts` e `npx tsc --noEmit` limpos antes de cada commit. Commit ao fim de cada task (mensagens em português, com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01ATqZgryoxRsTeXXM3HR8M7`).
- Loja do Sertão: `4f8a9e1a-6c3d-4b2e-9f7a-8e5c1d2b3a90` (Vendas) / `loja_id=4` (Estoque/Omie). Banco de produção: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240`, `docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas -f /dev/stdin < arquivo.sql`.

## Review Focus

- Impressora sem nenhum documento marcado (config nova vazia) → não pode ficar loja sem imprimir comprovante: comportamento padrão por `destination` deve continuar valendo enquanto `documentos` for NULL.
- Pré-conta automática ao pedir conta não pode imprimir 2× (cliente e garçom pedem quase juntos) → dedupe por mesa+minuto.
- Fechamento de caixa com turno sem nenhuma venda / só cartão / diferença de caixa → sem NaN, sem linha cortada.
- Hora do pedido: item criado ontem (mesa aberta atravessando meia-noite) → mostrar data+hora, não "há 1440 min".
- Cancelamento roteado por setor: item de categoria sem setor cai no destino (cozinha/bar), nunca some.

---

### Task 1: Consolidar o já feito (cancelar pedido de conta, comanda maior, cancelamento por setor)

**Files:**
- Create: `lib/setores.ts`, `scripts/testes/setorDoItem.test.ts`
- Modify: `components/modules/StoreModule.tsx` (imprimirCancelamento usa o helper), já modificados: `lib/api.ts`, `lib/print.ts`, `desktop/electron/print-engine.js`, `scripts/testes/layoutComanda.test.ts`
- Existing: `supabase/migrations/131_cancelar_pedido_de_conta.sql` (já aplicada no Contabo; função nova, aditiva)

**Interfaces:**
- Produces: `setorDoItem(product, catSetor): string | null` — setor do produto, senão o da categoria (respeitando `ignore_category_sector`).

- [ ] **Step 1: teste que falha**

```ts
// scripts/testes/setorDoItem.test.ts — rodar com: npx tsx scripts/testes/setorDoItem.test.ts
import assert from 'node:assert/strict';
import { setorDoItem } from '../../lib/setores';
const cat = { c1: 'PIZZARIA', c2: null } as Record<string, string | null>;
assert.equal(setorDoItem({ sector_id: 'X', category_id: 'c1' }, cat), 'X', 'setor do produto vence');
assert.equal(setorDoItem({ sector_id: null, category_id: 'c1' }, cat), 'PIZZARIA', 'pizza herda da categoria');
assert.equal(setorDoItem({ sector_id: null, category_id: 'c1', ignore_category_sector: true }, cat), null, 'produto pode ignorar a categoria');
assert.equal(setorDoItem({ sector_id: null, category_id: 'c2' }, cat), null, 'categoria sem setor');
assert.equal(setorDoItem(undefined, cat), null, 'produto indisponível');
console.log('ok');
```

- [ ] **Step 2: rodar e ver falhar** — `npx tsx scripts/testes/setorDoItem.test.ts` → Expected: erro "Cannot find module '../../lib/setores'".
- [ ] **Step 3: implementar** `lib/setores.ts`:

```ts
export function setorDoItem(
  product: { sector_id?: string | null; category_id?: string | null; ignore_category_sector?: boolean } | undefined | null,
  catSetor: Record<string, string | null>,
): string | null {
  if (!product) return null;
  return product.sector_id || (product.ignore_category_sector ? null : (product.category_id ? catSetor[product.category_id] : null)) || null;
}
```
- [ ] **Step 4:** trocar em `imprimirCancelamento` (StoreModule.tsx) o cálculo inline de `setorId` por `setorDoItem(it.product, locaisInfo.catSetor)`. Rodar o teste → Expected: `ok`.
- [ ] **Step 5:** `npx tsx scripts/testes/layoutComanda.test.ts && npx tsx scripts/testes/cancelamentoComanda.test.ts && npx tsc --noEmit` → Expected: `ok`, `ok`, sem erros.
- [ ] **Step 6: commit** `git add -A && git commit -m "feat: cancelar pedido de conta, comanda com fonte maior, cancelamento por setor"`.

### Task 2: Onde imprime cada documento (comanda ≠ pré-conta ≠ comprovante ≠ cupom fiscal ≠ fechamento)

**Files:**
- Create: `supabase/migrations/132_impressora_documentos.sql`, `lib/printDocs.ts`, `scripts/testes/printDocs.test.ts`
- Modify: `lib/api.ts` (`PrinterConfig`, `enqueueReceiptPrintJobs`, `hasActivePrinterForDestination`, `updatePrinterConfig`), `components/modules/StoreModule.tsx` (tela de impressoras + `handleRequestBill` + call sites), `components/modules/CaixaPrintStation.tsx` (comanda só nas impressoras com `comanda`)

**Interfaces:**
- Produces: `type DocPrint = 'comanda' | 'pre_conta' | 'comprovante' | 'cupom_fiscal' | 'fechamento_caixa'`; `documentosPadrao(destination)`; `impressoraRecebe(printer, doc): boolean`.
- Regra: `documentos IS NULL` → padrão pelo `destination` (kitchen/bar → `comanda`; receipt → pre_conta+comprovante+cupom_fiscal+fechamento_caixa; all → todos). `documentos` preenchido → vale exatamente o que está marcado.

- [ ] **Step 1: teste que falha** (`scripts/testes/printDocs.test.ts`)

```ts
import assert from 'node:assert/strict';
import { impressoraRecebe, documentosPadrao } from '../../lib/printDocs';
assert.deepEqual(documentosPadrao('kitchen'), ['comanda']);
assert.ok(documentosPadrao('receipt').includes('cupom_fiscal') && documentosPadrao('receipt').includes('pre_conta'));
assert.equal(impressoraRecebe({ destination: 'receipt', documentos: null }, 'pre_conta'), true, 'padrão do caixa');
assert.equal(impressoraRecebe({ destination: 'bar', documentos: null }, 'pre_conta'), false, 'bar não recebe pré-conta por padrão');
assert.equal(impressoraRecebe({ destination: 'bar', documentos: ['comanda', 'pre_conta'] }, 'pre_conta'), true, 'bar configurado p/ pré-conta');
assert.equal(impressoraRecebe({ destination: 'receipt', documentos: ['cupom_fiscal'] }, 'pre_conta'), false, 'caixa sem pré-conta');
assert.equal(impressoraRecebe({ destination: 'all', documentos: null }, 'fechamento_caixa'), true);
console.log('ok');
```
- [ ] **Step 2:** rodar → Expected: falha "Cannot find module '../../lib/printDocs'".
- [ ] **Step 3: implementar** `lib/printDocs.ts` (tipos + `documentosPadrao` + `impressoraRecebe`) conforme as Interfaces; rodar → `ok`.
- [ ] **Step 4: migration 132** (aditiva): `alter table printer_configs add column if not exists documentos text[];` + comentário. Aplicar no Contabo (`ntb_vendas`) — coluna nova NULL não muda nada para os apps atuais.
- [ ] **Step 5:** `enqueueReceiptPrintJobs(storeId, title, content, dedupeKeyBase, doc)` — novo parâmetro `doc: DocPrint` (default `'comprovante'`); a seleção de impressoras passa a buscar todas as ativas rede/USB e filtrar com `impressoraRecebe(p, doc)` em vez de `destination in ('receipt','all')`. Idem `hasActivePrinterForDestination(..., 'receipt')` → função nova `hasActivePrinterForDoc(storeId, doc)`. Atualizar os call sites: conferência/pré-conta → `'pre_conta'`; comprovante de pagamento → `'comprovante'`; cupom fiscal (linhas ~754/766) → `'cupom_fiscal'`.
- [ ] **Step 6:** `CaixaPrintStation`: só enfileira comanda em impressora que `impressoraRecebe(p, 'comanda')` (mantém regra de destino/setor atual).
- [ ] **Step 7: UI** na tela de impressoras: por impressora, 5 checkboxes "Comanda / Pré-conta / Comprovante de pagamento / Cupom fiscal / Fechamento de caixa" (rótulos em português), salvando `documentos`; aviso quando nenhuma impressora recebe um documento.
- [ ] **Step 8: pré-conta automática:** em `handleRequestBill` (e no pedido de conta do cliente), após `requestTableBill`, chamar o mesmo enfileiramento de `printTableBill` para `'pre_conta'` com `dedupeKeyBase = pre-conta:${tableId}:${minutoAtual}` (evita 2×).
- [ ] **Step 9:** `npx tsx scripts/testes/printDocs.test.ts && npx tsc --noEmit` → `ok`, sem erro; commit `feat: configurar onde imprime cada documento`.

### Task 3: Relatório de fechamento de caixa impresso ("POSIÇÃO DO CAIXA")

**Files:** Create `scripts/testes/fechamentoCaixa.test.ts`; Modify `lib/print.ts` (`buildCashClosingText`), `components/modules/StoreModule.tsx` (ao fechar turno: enfileirar `'fechamento_caixa'`).

**Interfaces:** `buildCashClosingText({ storeName, operador, abertoEm, fechadoEm, fundo, porForma: {label,total}[], cartoes: {label,total}[], descontos, cupons, ticketMedio, vendaBruta, vendaLiquida, dinheiroNoCaixa, paperWidthMm }): string` — layout em colunas, mesmo estilo da pré-nota; sem "nº de pessoas" (não existe no sistema).

- [ ] **Step 1: teste** — gera texto p/ 80 mm e 58 mm com dados do exemplo do Ramon (fundo 100, dinheiro 222,86, crédito 978,01, débito 229,09, PIX 684,77) e afirma: nenhuma linha passa das colunas; total de vendas = soma; "Dinheiro no caixa" = fundo + dinheiro; título "POSICAO DO CAIXA".
- [ ] **Step 2:** rodar → falha (função não existe). **Step 3:** implementar. **Step 4:** rodar → `ok`.
- [ ] **Step 5:** ligar ao fechamento do turno (dados vêm de `fetchCashShiftSummary`); falha de impressão nunca impede o fechamento (mesmo padrão dos comprovantes).
- [ ] **Step 6:** `npx tsc --noEmit`; commit `feat: imprime posição do caixa ao fechar o turno`.

### Task 4: Hora do pedido na comanda (tela)

**Files:** Create `lib/tempo.ts`, `scripts/testes/tempoPedido.test.ts`; Modify `components/modules/StoreModule.tsx` (lista de itens da mesa).

**Interfaces:** `descreverHoraDoPedido(criadoEm: string|Date, agora?: Date): string` → `"19:23 · há 12 min"`; mais de 6 h ou dia diferente → `"ontem 23:40"`/`"28/09 23:40"`.

- [ ] **Step 1: teste** cobrindo: 12 min atrás; 1 h 5 min ("há 1 h 5 min"); ontem; entrada inválida → `''`.
- [ ] **Step 2:** rodar → falha. **Step 3:** implementar. **Step 4:** rodar → `ok`.
- [ ] **Step 5:** mostrar `descreverHoraDoPedido(item.created_at)` sob cada item da comanda em tela (atualiza a cada minuto); verificar `order_items.created_at` existe no select.
- [ ] **Step 6:** `npx tsc --noEmit`; commit `feat: hora do pedido em cada item da comanda`.

### Task 5: Baixa de estoque no local certo (Bar / Cozinha)

**Files:** nenhum código novo — o Estoque já resolve o local (`lojas.local_estoque_cozinha_codigo` / `local_estoque_bar_codigo`, migration 120) e o Vendas já envia `destination`. Falta só a config da loja 4.

- [ ] **Step 1 (verificação, sem escrever):** confirmar em `ntb estoque/lib/vendas-integracao.ts:193` e na rota de OP que `destination` → local e que `movimentos` SAI usa `localMapeado`. Registrar no ledger.
- [ ] **Step 2 (JANELA — só com o dono liberando):** `update lojas set local_estoque_bar_codigo = 2354627389, local_estoque_cozinha_codigo = 5906914581 where id = 4;` (BAR e COZINHA do Omie da loja 4; PIZZA = 5906914974 fica para decidir com o Ramon). Reversível (voltar para NULL).
- [ ] **Step 3:** após a janela, fazer 1 venda de teste de refrigerante e conferir no Omie o local da baixa. As vendas anteriores (padrão DEPOSITO) só se corrigem se o dono mandar.

### Task 6: Motor de impressão liga sozinho, sem login

**Files:** Modify `desktop/electron/main.js`, `desktop/electron/print-engine.js` (+ `webapp` se necessário); Create `desktop/scripts/testes/motorAutoStart.test.js` (lógica pura de "qual loja iniciar").

**Interfaces:** `lojaSalva()` lê `storeId` persistido (electron-store/arquivo em userData); `printEngine.start(storeId, …)` chamado em `app.whenReady` se existir loja salva; `ntb-start-print-engine` continua funcionando (login) e grava a loja.

- [ ] **Step 1:** ler `main.js` (`ntb-start-print-engine`, ~L539) e `print-engine.start` para ver o que ele precisa (storeId + chave anon + URL).
- [ ] **Step 2: teste** da função pura `decidirInicio({ lojaSalva, motorRodando })` → `'iniciar' | 'nada'`.
- [ ] **Step 3:** implementar persistência ao iniciar via login e auto-start no boot; parar no logout explícito (apaga a loja salva).
- [ ] **Step 4:** `node desktop/scripts/testes/motorAutoStart.test.js` → `ok`; `node -e "require('./desktop/electron/print-engine.js')"` sem erro.
- [ ] **Step 5:** commit `feat(desktop): motor de impressão inicia sozinho com a loja salva`.

### Task 7: Estoque — marca "Veio do Norte Vendas" + investigação das OPs sumidas

**Files:** `ntb estoque` (repo separado) — já alterados: `components/ordem-producao/OrdemProducaoRow.tsx`, `app/(app)/ordem-producao/page.tsx`, `lib/vendas-integracao.ts`.

- [ ] **Step 1:** `npx tsc --noEmit` no ntb estoque → sem erros; commit `feat: etiqueta "Veio do Norte Vendas" em todas as lojas`.
- [ ] **Step 2 (investigação, só leitura):** por que 3 das 4 OPs da venda de 17:14 (nCodOP 6959895415/462/480) e 4 do teste das 12:27 não existem no Omie (ConsultarOrdemProducao = "não cadastrada"; ListarOrdemProducao só traz 4). Hipóteses a checar: exclusão por `estornarVenda`/limpeza; OP concluída que o Omie remove; erro mascarado como sucesso em `concluirOrdemProducao`. Resultado vai para o dono; **não recriar OP sem autorização** (mexe em estoque real).

### Task 8: Release (SEGURADA)

- [ ] Só quando o dono liberar (com o sistema parado): subir versão do desktop (1.2.65), `desktop/scripts/publish.sh`; APK se houver mudança mobile; `deploy.sh` do Vendas; deploy manual do Estoque (`git pull` + build + restart); rodar Task 5 Step 2; calibrar a impressão com teste no PC-SERVIDORR (largura da página do driver ou modo raw para Cozinha/Bar/Caixa).
