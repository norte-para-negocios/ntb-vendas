# Frente de Caixa — turno, fila de recebíveis, sangria/suprimento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o Caixa de "quem tem a permissão finaliza" em uma operação real de frente de caixa: turno com fundo de troco, uma fila única reunindo tudo que aguarda pagamento, controle de sangria/suprimento, e cada pagamento rastreável a um operador e turno. **É plataforma, não Sertão** — qualquer loja com o módulo `caixa` ligado passa a ter isso; não é um flag separado.

**Architecture:** Duas tabelas novas (`cash_shifts`, `cash_movements`), um campo de auditoria em `orders.payment_details` (`cash_shift_id`), uma trava no fluxo de pagamento existente (sem turno aberto, `handleFinishPayment`/`closeCounterOrder`-equivalente recusa), e uma aba nova "Caixa" no painel do lojista — a fila consolidada de recebíveis, que é o que faltava pra "aba caixa" existir de verdade.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Supabase (Postgres + RPCs `security definer`).

**Spec:** Documento de referência "Frente de Caixa" (artifact compartilhado pelo usuário, 21/08/2026, origem: feedback de cliente prospect em reunião comercial). Este plano implementa a **Fase 1 (P0)** desse documento — papel, turno e fila — deliberadamente, deixando Fase 2 (múltiplos caixas simultâneos, alçada de gerente, alertas, exportação, reimpressão) e Fase 3 (fiscal automático via fechamento, TEF, multi-loja) fora de escopo, exatamente como o próprio documento sugere.

## Decisões tomadas aqui, sem round de pergunta (documento tinha 4 em aberto)

1. **PIN de operador não é numérico separado.** O login individual (e-mail/senha, `store_users` com `role='cashier'`) já cumpre "papel de operador de caixa distinto do PIN de mesa" — construído hoje mais cedo. Um PIN em cima disso seria redundante.
2. **V1 assume um turno aberto por loja por vez**, não múltiplos caixas simultâneos — é literalmente o que o documento já classifica como P1 ("funciona sem isso, mas melhora a operação").
3. **Emissão fiscal não muda.** Já dispara automaticamente no fechamento do pedido, com o toggle por venda construído hoje. O fechamento de turno é sobre dinheiro físico, não sobre nota — sem relação direta nesta fase.
4. **A fila consolidada é uma aba nova, ao lado de Mesas e Balcão — não substitui nenhuma delas.** O garçom continua em Mesas; o caixa ganha uma aba própria.

## Global Constraints

- **Todas as 7 lojas reais continuam funcionando exatamente como hoje, EXCETO o Sertão** (única com `modules.caixa: true` em produção hoje). Nenhuma das outras 6 tem o módulo Caixa ligado — o comportamento delas é inteiramente inalterado, porque toda a trava nova (`turno aberto obrigatório`) só existe dentro do código já gated por `permissions.caixa === true` + `resolveStoreModules(store).caixa === true`.
- **O Sertão vai passar a exigir turno aberto pra receber pagamento** assim que isso for pro ar. Ninguém está usando em produção ainda (loja não abriu) — não há usuário real impactado, mas registrar isso é importante: depois deste plano, testar de ponta a ponta em `zz-laboratorio` E confirmar no Sertão que dá pra abrir turno antes do dia 1º.
- Migration sempre com `notify pgrst, 'reload schema';`.
- `SERVICE_FEE_RATE`/formatação de dinheiro só em `lib/calc.ts`. Troco/sangria/suprimento usam a mesma disciplina — nada de `.toFixed(2)` inline.
- `escapeHtml()` obrigatório em todo campo de texto livre que chega em documento impresso (o relatório de fechamento pode ser impresso — se for, mesma regra).
- Rótulo de enum sempre de `lib/labels.ts`.
- Motion: só `SPRING_TAP`/`SPRING_SHEET`. Tailwind v4, tokens semânticos, nunca hex cru.
- Sem suíte de testes. `npm run build` é o portão.
- Todo teste de escrita vai em `ZZ Laboratorio (NAO E CLIENTE)` (`zz-laboratorio`, `is_test=true`). Nunca nas 7 lojas reais — e cuidado redobrado aqui porque o Sertão É uma das 7 com o módulo já ligado; qualquer teste que abra/feche turno de verdade tem que ser em `zz-laboratorio`, nunca no Sertão.
- **Produção (Contabo) é o único banco.** `.env.local` aponta pra lá.

---

### Task 1: Schema — turno e movimentações de caixa

**Files:**
- Create: `supabase/migrations/051_frente_de_caixa.sql`

**Interfaces:**
- Produz: `cash_shifts (id, store_id, operator_user_id, opened_at, closed_at, opening_float numeric, closing_counted_cash numeric, status text check in ('open','closed'), notes text)`.
- Produz: `cash_movements (id, shift_id, type text check in ('sangria','suprimento'), amount numeric > 0, reason text not null, created_at)`.
- Produz: RPCs `security definer`: `open_cash_shift_secure(store_id, operator_user_id, opening_float)`, `close_cash_shift_secure(shift_id, closing_counted_cash)`, `register_cash_movement_secure(shift_id, type, amount, reason)`, `fetch_open_cash_shift_secure(store_id, operator_user_id)`, `fetch_cash_shift_summary_secure(shift_id)` (retorna total por forma de pagamento + sangrias/suprimentos + esperado vs conferido + diferença).

- [ ] **Passo 1: Migration**

Seguir o padrão de segurança já estabelecido no projeto (RLS fechada, tudo via `security definer`, mesmo nível de `close_table_orders_secure`). `cash_shifts`/`cash_movements` sem policy de SELECT/INSERT direta pra `anon` — só via as RPCs. Um índice parcial garantindo **no máximo um turno `status='open'` por `store_id`** (`create unique index ... where status = 'open'`) — é o jeito mais barato de fazer valer a decisão "um turno por vez" sem lógica de aplicação que pode falhar sob concorrência.

`open_cash_shift_secure` deve recusar (retornar erro claro, não exceção genérica) se já existe turno aberto pra aquela loja.

`close_cash_shift_secure` deve recusar se o turno já está fechado, e deve calcular e persistir a diferença (`closing_counted_cash` menos o esperado em dinheiro, calculado a partir dos pagamentos vinculados ao turno).

- [ ] **Passo 2: Aplicar em produção, testar as 5 RPCs isoladamente via `zz-laboratorio`**

Abrir turno, tentar abrir um segundo (deve recusar), registrar sangria e suprimento, fechar com um valor conferido diferente do esperado (confirmar que a diferença calculada bate), tentar operação após fechado (deve recusar). Limpar tudo depois.

- [ ] **Passo 3: `npm run build` limpo, commit**

```
feat(caixa): schema de turno, sangria e suprimento
```

---

### Task 2: Auditoria — vincular pagamento ao turno

**Files:**
- Modify: `lib/api.ts` (`closeTableSession`, `closeCounterOrder`, a rota de Balcão)
- Modify: `components/modules/StoreModule.tsx` (`handleFinishPayment` e equivalente do Balcão)

**Interfaces:**
- Consome: `fetch_open_cash_shift_secure` da Task 1.
- Produz: `orders.payment_details.cash_shift_id` (uuid, presente só quando a loja tem o módulo caixa ligado).

- [ ] **Passo 1: A trava real — "sem caixa aberto, não recebe pagamento"**

Onde `handleFinishPayment` (mesa) e o equivalente do Balcão hoje chamam a finalização, se `resolveStoreModules(store).caixa === true`: buscar o turno aberto do operador logado (`fetch_open_cash_shift_secure`). Se não houver, **bloquear a ação** — nada de finalizar, com uma mensagem clara guiando pra abrir o caixa primeiro (não um erro genérico). Se a loja NÃO tem o módulo caixa, nada disso executa — comportamento intocado.

- [ ] **Passo 2: Gravar o vínculo**

O `cash_shift_id` do turno aberto entra em `payment_details` junto com os outros campos já lá (métodos, bandeira, `emitir_nota`) — mesmo padrão de sempre, sem coluna nova em `orders`.

- [ ] **Passo 3: Testar em `zz-laboratorio`**

Sem turno aberto: tentar finalizar uma mesa, confirmar que é bloqueado com mensagem clara. Abrir turno, finalizar, confirmar `cash_shift_id` gravado. Confirmar que uma loja sem o módulo caixa (a maioria das lojas de teste) finaliza normal, sem pedir turno nenhum.

- [ ] **Passo 4: `npm run build` limpo, commit**

```
feat(caixa): pagamento exige turno aberto, vinculado ao turno na gravacao
```

---

### Task 3: Aba "Caixa" — fila consolidada de recebíveis

**Files:**
- Modify: `components/modules/StoreModule.tsx` (nova aba/view)
- Modify: `lib/storeModules.ts` (se a aba precisar de uma entrada em `TAB_MODULE_KEY`/`TAB_IDS`)

**Interfaces:**
- Consome: dados já buscados de mesas (`waiting_bill`) e pedidos de balcão pendentes — mesma fonte que já alimenta `TablesView`/`CounterView`, sem query nova.

- [ ] **Passo 1: A aba em si**

Uma aba "Caixa", visível só quando `resolveStoreModules(store).caixa === true` **e** `permissions.caixa === true` (mesmo gate já usado pro resto do módulo). Lista: todas as mesas com status `waiting_bill` + todos os pedidos de balcão aguardando pagamento, ordenados por tempo de espera (mais antigo primeiro). Cada item mostra identificação (mesa/balcão), valor, tempo esperando. Tocar abre o modal **Receber Pagamento já existente** — reaproveitar, não duplicar.

- [ ] **Passo 2: Estado de turno visível na própria aba**

Se não há turno aberto: a aba mostra isso claramente, com a ação de abrir caixa (fundo de troco) em destaque — é o primeiro lugar que o operador vê ao entrar. Se há turno aberto: mostra a fila, mais um resumo pequeno (aberto desde, fundo de troco) e o botão de fechar caixa.

- [ ] **Passo 3: Testar em `zz-laboratorio`**

Login como caixa, aba aparece. Sem turno: tela de abrir caixa. Abrir com fundo de troco, mesa pede conta, item aparece na fila, tocar abre o pagamento existente, pagamento gravado com o turno certo (RE-verificar a trava da Task 2 nesse fluxo real, não só isolado).

- [ ] **Passo 4: `npm run build` limpo, commit**

```
feat(caixa): aba caixa com fila consolidada de recebiveis
```

---

### Task 4: Sangria, suprimento e fechamento de turno

**Files:**
- Modify: `components/modules/StoreModule.tsx` (UI dentro da aba Caixa)

**Interfaces:**
- Consome: `register_cash_movement_secure`, `close_cash_shift_secure`, `fetch_cash_shift_summary_secure` da Task 1.

- [ ] **Passo 1: Sangria e suprimento**

Dentro da aba Caixa, com turno aberto: um botão/formulário simples — tipo (sangria/suprimento), valor, motivo (obrigatório). Grava via `register_cash_movement_secure`.

- [ ] **Passo 2: Fechamento**

Botão "Fechar Caixa" abre uma tela com o resumo (`fetch_cash_shift_summary_secure`): total por forma de pagamento, total de sangrias/suprimentos, valor esperado em dinheiro, campo pra digitar o valor conferido, diferença calculada ao vivo enquanto digita. Confirmar fecha o turno via `close_cash_shift_secure` — depois disso a aba volta ao estado "sem turno aberto".

- [ ] **Passo 3: Testar em `zz-laboratorio`**

Ciclo completo: abrir turno com fundo de troco, uma venda em dinheiro, uma sangria, fechar com valor conferido igual ao esperado (diferença zero) e depois um ciclo separado com valor diferente (confirmar a diferença aparece certa, positiva e negativa).

- [ ] **Passo 4: `npm run build` limpo, commit**

```
feat(caixa): sangria, suprimento e fechamento de turno com conferencia
```

---

## Fora de escopo deste plano (Fase 2/3 do documento, não é agora)

- Múltiplos caixas simultâneos por loja.
- Alçada de gerente pra cancelar/estornar pagamento já lançado.
- Alerta visual de mesa esperando há muito tempo.
- Exportação do fechamento (PDF/planilha).
- Reimpressão de comprovante a partir do histórico do turno.
- Emissão fiscal automática disparada pelo fechamento (hoje já dispara no fechamento do PEDIDO, que é diferente e já existe).
- Conciliação com TEF, consolidação multi-loja, previsão de troco.
