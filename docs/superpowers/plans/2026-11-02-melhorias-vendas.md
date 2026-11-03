# Melhorias Norte Vendas (análise 02/11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar as falhas de segurança, dinheiro e operação achadas na análise de 02/11, sem quebrar loja aberta nem app antigo instalado.

**Architecture:** Toda trava nova de segurança é ADITIVA e fica dormente atrás de `seg_flags.exigir_sessao` (migration 182) até os apps 1.2.117/1.2.118 dos PCs serem atualizados; o corte (flag ligada + revogar funções antigas + tirar `allow_all_anon`) é um passo operacional separado (Task 9), mesmo padrão 021→022. Correções de dinheiro/fiscal/UX entram direto.

**Tech Stack:** Next.js 16, React 19, Supabase self-hosted (PostgREST + plpgsql), testes `npx tsx scripts/testes/*.test.ts` (node:assert), portão `scripts/e2e/portao-deploy.sh`.

**Spec:** a análise enviada ao usuário em 02/11 (resumo na conversa) + `AGENTS.md`. Sem doc de spec separado: rulings aqui são provisórios e vão para o ledger.

## Global Constraints

- Nunca testar no Sertão (`O Sertão Vai Virar Mar`); loja de teste = ZZ Laboratório / Casa Norte.
- Fiscal só em homologação (exceto ODARA real, que não é testada aqui).
- Nunca escrever no Omie sem OK do usuário (reenvio de NFC-e presa = pedir OK).
- `npm run dev` fala com produção: sempre `DISABLE_FISCAL_RETRANSMISSAO=1 DISABLE_BAIXA_RETRY=1`.
- Migrations NÃO são aplicadas pelos executores; ficam em `supabase/migrations/19x_*.sql` e o controlador aplica de madrugada (`docker exec -i supabase-db psql -U supabase_admin -d ntb_vendas`, depois `NOTIFY pgrst, 'reload schema'`).
- Deploy do Vendas só de madrugada, depois do portão passar.
- Toda escrita nova no banco por RPC `security definer` com `p_token text default null` validado por `_sessao_ok` (182). Nunca `.from('tables')`.
- Texto de tela em português simples; nome do produto é "Norte Vendas".
- Migrations novas: 191 (segurança), 192 (fiscal/cupom), 193 (baixas). Ninguém usa outro número.

## Review Focus

1. App antigo (1.2.117) chamando função antiga depois do deploy — tudo tem que continuar funcionando com a flag desligada.
2. Mesa com conta dividida "Por pessoa" (nota por pessoa) — índice único novo não pode barrar a 2ª pessoa.
3. Modo Aberto (login "Mesas") — ações com senha de quem autoriza continuam funcionando.
4. Sem internet — fila offline (`lib/offline/sync.ts`) que chama RPCs que mudaram de assinatura.
5. Baixa reenviada que o Estoque já tinha processado = baixa em dobro no Omie (pior falha possível do Task 6).

---

### Task 1: Caixa cancela/move item da janela de pagamento — FEITO (f546588)

### Task 2: Nota fiscal sem duplicar e sem sumir

**Files:** Modify `app/api/fiscal/emitir/route.ts`, `lib/api.ts` (`triggerEmissaoFiscal`); Create `supabase/migrations/192_fiscal_trava_venda_e_cupom.sql`; Test `scripts/testes/fiscalChaveVenda.test.ts`.

- [ ] Teste: `chaveDaVendaResolvida({storeId, orderIds:['b','a'], pessoa:null, itemIds:[]})` === `chaveDaVendaResolvida({storeId, orderIds:['a','b'], ...})` e difere quando `pessoa` muda; chamada por `{tableId}` e por `{orderId}` da mesma venda resolvem a mesma chave (`'venda|<store>|<orderIds[0]>|<pessoa>'`).
- [ ] Extrair `chaveDaVendaResolvida` para `lib/fiscal/chaveVenda.ts` e adquirir `adquirir_trava_emissao` DEPOIS de resolver `orderIds` (mantém a trava em memória antiga como primeira barreira).
- [ ] 192: `create unique index if not exists fiscal_notas_unico_venda_v2 on fiscal_notas (store_id, order_id) where status='autorizada' and order_id is not null and pessoa_identificador is null and created_at >= '2026-11-03'` (há 1 duplicada antiga em produção).
- [ ] `triggerEmissaoFiscal`: em falha de rede/HTTP ≠ 200, enfileirar em `lib/offline` (fila de nota já existe: `enfileirarNotaSemInternet`) em vez de só `console.error`.
- [ ] Rodar testes, commit.

### Task 3: Arredondamento de taxa e divisão

**Files:** Modify `lib/calc.ts`, `lib/divisaoPorPessoa.ts`; Test `scripts/testes/calcArredonda.test.ts`.

- [ ] Teste: `calculateServiceFee(33.33)` === `3.33`; `calculateOrderTotal(33.33, true)` === `36.66`; soma de `calculateSplitByPerson` de 3 pessoas com subtotal 10 cada (taxa 10%) === total da mesa (33.00) e cada parte com 2 casas.
- [ ] `calculateServiceFee` = `Math.round(subtotal*rate*100)/100`; divisão joga diferença de centavo na última parte.
- [ ] Rodar todos os testes de `scripts/testes/` (vários usam calc), commit.

### Task 4: Cupom de desconto escondido e tabela fechada

1 cupom cadastrado, 0 usos: o desconto nunca foi cobrado (só aparecia na tela do cliente).
- [ ] `ClientModule.tsx`: não renderizar o campo de cupom nem `couponDiscount` no total (deixar o código atrás de `const CUPOM_LIGADO = false`).
- [ ] 192: `discount_coupons` sem escrita anon (drop policies insert/update/delete; select fica, `validateAndApplyCoupon` lê). `createCoupon/updateCoupon/deleteCoupon` viram RPC `*_coupon_secure(p_store_id, ..., p_token)`.
- [ ] Commit.

### Task 5: Segurança (dormente atrás da flag) — migration 191

**Files:** Create `supabase/migrations/191_seguranca_escritas_e_rotas.sql`, `lib/server/exigirSessao.ts`; Modify `lib/api.ts`, `app/api/**/route.ts` (sensíveis), `app/api/orders/pagamento-balcao/route.ts`; Tests `scripts/testes/exigirSessao.test.ts`, `scripts/testes/pagamentoBalcaoValor.test.ts`.

- [ ] RPCs novas (security definer, `p_token text default null`, `_sessao_ok(p_token, p_store)`):
  `update_store_config_secure(p_store_id, p_config jsonb, p_token)`, `update_store_cover_secure`, `create_category_secure`, `delete_category_secure`, `update_category_fields_secure(p_category_id, p_fields jsonb, p_token)` (só `available_from/until/days, group_id, sector_id`). Master Admin (`createStore/updateStore/duplicateStore/deleteStore`): `*_store_secure` com `_sessao_ok` tipo admin/universal.
- [ ] `lib/api.ts`: essas funções passam a chamar as RPCs com `p_token: tokenLoja()`/`tokenAdmin()`. Não remover policy `allow_all_anon` ainda (Task 9).
- [ ] `close_table_orders_v2(p_table_id, p_payment_method, p_payment_details, p_operator_user_id, p_token)`: confere `_sessao_ok`, que a mesa é da loja da sessão, filtra só pedidos abertos (não regrava `order_items` históricos), e recusa se `p_payment_details->>'total'` < soma dos itens não cancelados − 0,01 (exceto `COURTESY`). `closeTableSession` e `lib/offline/sync.ts` usam a v2 com fallback para a antiga em `PGRST202`.
- [ ] `verify_store_staff_login_secure`: bloqueio por USUÁRIO (`store_users.login_attempts/login_locked_until`, 10 erros → 1 min crescente até 15 min), não por loja.
- [ ] `lib/server/exigirSessao.ts`: `exigirSessao(req, storeId): Promise<null | Response>` lê `x-ntb-sessao`, só bloqueia (401 JSON) se `seg_flags.exigir_sessao` = true; confere token em `sessoes_app` (não vencido, mesma loja ou tipo universal/admin). `cabecalhosApi()` passa a mandar `x-ntb-sessao`. Aplicar em: `fiscal/cancelar`, `fiscal/exportar`, `certificado`, `integracao/configurar`, `integracao/baixas`, `integracao/omie-direto`, `integracao/criar-loja-estoque`, `push/send`. (Não em `fiscal/emitir`/`ordem-producao`, chamadas pelo fechamento — entram no corte, Task 9.)
- [ ] `pagamento-balcao` (pagar): exigir `storeId` e filtrar por ele; recalcular total do pedido no servidor e recusar se `paymentDetails.total` ou soma dos `methods` < total − 0,01.
- [ ] Testes, commit.

### Task 6: Baixa de estoque "incerta" se resolve sozinha

341 baixas do Sertão em 30 dias ficaram `incerto` por timeout (150 s) e ninguém confere.
**Files:** Estoque: `app/api/integracao/ordem-producao/route.ts` (+ rota de consulta); Vendas: `lib/baixaEstoqueServidor.ts`, `lib/baixaEstoque.ts`, `lib/baixaEstoqueRetry.ts`, migration `193_baixas_conferencia.sql` se precisar coluna.
- [ ] Estoque: `GET /api/integracao/ordem-producao/status?pedidoRef=` (mesma auth Bearer) devolve `{processado: boolean, itens:[{codigo, nCodOP}]}` a partir do que a rota grava para o `pedidoRef`. Se a rota não grava `pedidoRef`, gravar.
- [ ] Vendas: no ciclo, `incerto` por timeout com mais de 10 min → consulta status; `processado` → `ok` ("Conferido sozinho no Estoque"); não processado → volta a `erro` retentável (o Estoque deduplica por `pedidoRef` no envio). Nunca reenviar sem a consulta responder.
- [ ] Teste do classificador puro (`decidirIncerto(statusEstoque)`), commit nos dois repos.

### Task 7: Menos recarga em noite cheia

**Files:** `lib/usePolling.ts`, Create `lib/useRecargaAgrupada.ts`, Modify `components/modules/StoreModule.tsx` (KdsView ~1792, TablesView ~3903, CounterView ~7096, CaixaViewMeu ~8210, StoreTableMenu ~2296).
- [ ] Teste: `agrupar(fn, 800)` chamado 10× em 100 ms executa 1 vez; nova chamada depois de 800 ms executa de novo.
- [ ] Pings realtime chamam a recarga agrupada (800 ms); `usePolling` pula o ciclo se houve recarga há menos de 4 s (`ultimaRecarga` ref).
- [ ] Cardápio do garçom: a cada 15 s só busca disponibilidade (`select id, available, sold_out` de `products` da loja via função nova em `lib/disponibilidade.ts`, NÃO em `lib/api.ts`) e funde no estado; cardápio inteiro só ao abrir.
- [ ] Commit.

### Task 8: Garçom não perde trabalho

**Files:** `components/modules/StoreModule.tsx` (diálogo mover ~5472, `confirmarMoverItem`, carrinho de mesa ~4724).
- [ ] Mover item: no diálogo, lista com checkbox dos outros itens não cancelados da mesma mesa ("Mover também"); `transferItems` já aceita lista.
- [ ] Rascunho do carrinho de mesa em `localStorage` (`ntb-rascunho-mesa:<storeId>:<tableId>`), restaurado ao reabrir a mesa, apagado ao enviar ou descartar.
- [ ] Commit.

### Task 9: Corte de segurança (operação, não código) — só com OK e PCs atualizados

- [ ] Conferir `app_instances` (todos ≥ versão com Task 5) e `pg_stat_user_functions` sem chamada às antigas por 2 dias.
- [ ] `update seg_flags set valor = true where chave='exigir_sessao'`; aplicar `160_revoga_funcoes_antigas.pendente.sql` + revogar `close_table_orders_secure` antiga; trocar `allow_all_anon` de `stores`/`categories` por `select using (true)`.

### Task 10: Operação (sem código) — reportar ao usuário

- Relógio do PC de impressão do Sertão ~3 min atrasado e piorando (sincronizar hora do Windows).
- 4 pedidos esquecidos em `pending` no Sertão (03/10 R$ 399,60; 19/10 ×2; 24/10 balcão) — só com loja fechada.
- 190 NFC-e do Sertão (05–18/10) `na_fila` no Omie + 25 sem status — reenviar exige OK (escreve no Omie).
