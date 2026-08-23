# Perfis de Loja + Estação de Impressão + Módulo Caixa

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada loja escolhe quais módulos existem nela. O Sertão passa a operar sem KDS: o garçom lança, envia, e o pedido imprime sozinho numa estação na cozinha. As outras 6 lojas continuam exatamente como estão.

**Architecture:** Um bloco `modules` em `stores.config` (jsonb já existente, sem migration de schema) descreve o perfil da loja. `StoreModule` passa a cruzar a permissão do usuário com os módulos da loja, e a conta universal deixa de ter as 6 permissões fixas no código. Um fluxo `direct_print` substitui o KDS: ao enviar, o pedido é marcado como enviado e uma estação de impressão aberta na cozinha imprime sozinha via Realtime.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Supabase (Postgres + Realtime), `lib/print.ts` (iframe oculto, consertado em 22/08).

**Spec:** Sem documento separado. A fonte é o backlog de 21-22/08 (`docs/backlog-2026-08-21-garcom-caixa.md`) e a correção do usuário em 22/08: *"não é pra ter bar/cozinha, não é pra ter acompanhamento de pedido, não é pra ficar pressionando. É só clicar: caixa, garçom, gestão de mesa. Lança e imprime. Pode ter só um histórico dos pedidos enviados. O lojista/ADM vê tudo."*

## Global Constraints

- **Nenhuma das outras 6 lojas pode mudar de comportamento.** Loja sem `modules` configurado se comporta exatamente como hoje: todos os módulos ligados, fluxo KDS. O default é o comportamento atual, sempre.
- **`stores.config` é jsonb e já existe** — não criar coluna nova, não criar tabela nova para o perfil. Migration só se for realmente inevitável, e nunca sem `notify pgrst, 'reload schema';`.
- **Dois bancos.** Produção é o Postgres self-hosted no Contabo (`185.193.66.240`, container `supabase-db`, banco `ntb_vendas`, usuário `-U supabase_admin`). O `.env.local` local aponta para o Supabase Cloud, que é **dev** — o banco de dev tem lojas fictícias (Bar do Zé, Açaiteria Tropical, Padaria Aurora). Se a lista de lojas tiver nome que não é cliente real, é o banco errado. Qualquer migration vai nos DOIS.
- **`SERVICE_FEE_RATE` e formatação de taxa só em `lib/calc.ts`.** Nunca `subtotal * 0.1` inline.
- **Impressão:** `lib/print.ts` monta documento com `document.write()` num iframe **same-origin**, que tem acesso total ao painel logado. `escapeHtml()` é a única barreira e é obrigatório em todo campo de texto livre.
- Motion: só `SPRING_TAP` / `SPRING_SHEET` de `lib/motion.ts`.
- Tailwind v4, tokens semânticos de `app/globals.css` (`--surface`, `--border`, `--text`, `--ink`) — nunca hex cru.
- Sem suíte de testes (`package.json` só tem dev/build/start/lint). `npm run build` é o portão de compilação.
- **Nunca emitir nota fiscal real** em teste. Homologação sempre.

---

### Task 1: Perfil de módulos por loja

**Files:**
- Modify: `types.ts` (tipo `StoreModules`)
- Modify: `lib/storeModules.ts` (criar) — resolução do perfil, função pura
- Modify: `components/modules/StoreModule.tsx` (`canAccess`, `UNIVERSAL_PERMISSIONS`, `navTabs`)
- Modify: `components/modules/AdminModule.tsx` (UI de configuração na criação e edição de loja)

**Interfaces:**
- Produz: `resolveStoreModules(store): StoreModules` — sempre retorna todos os módulos ligados quando `config.modules` é ausente.
- Produz: `StoreModules = { tables, counter, kitchen_kds, bar_kds, caixa, menu, admin }` (todos boolean) e `order_flow: 'kds' | 'direct_print'`.

- [ ] **Passo 1: Tipo e resolução**

Criar `lib/storeModules.ts` com o tipo e a função de resolução. A regra que não pode quebrar: **ausência de configuração significa tudo ligado e fluxo `kds`** — é o comportamento das 6 lojas atuais.

```ts
export type StoreModules = {
  tables: boolean; counter: boolean; kitchen_kds: boolean;
  bar_kds: boolean; caixa: boolean; menu: boolean; admin: boolean;
};
export type OrderFlow = 'kds' | 'direct_print';

const ALL_ON: StoreModules = {
  tables: true, counter: true, kitchen_kds: true,
  bar_kds: true, caixa: true, menu: true, admin: true,
};

export const resolveStoreModules = (store?: { config?: any } | null): StoreModules => {
  const m = store?.config?.modules;
  if (!m || typeof m !== 'object') return ALL_ON;
  return { ...ALL_ON, ...m };
};

export const resolveOrderFlow = (store?: { config?: any } | null): OrderFlow =>
  store?.config?.order_flow === 'direct_print' ? 'direct_print' : 'kds';
```

- [ ] **Passo 2: `canAccess` cruza permissão do usuário com módulo da loja**

Em `StoreModule.tsx:5726`, `canAccess(t)` hoje olha só `user.permissions`. Passa a exigir as duas coisas: o usuário tem permissão **e** a loja tem o módulo. `kitchen` mapeia para `kitchen_kds`, `bar` para `bar_kds`.

- [ ] **Passo 3: Conta universal deixa de ter permissões fixas**

`UNIVERSAL_PERMISSIONS` (`StoreModule.tsx:40`) é um objeto literal com as 6 permissões `true`, usado em 3 lugares (linhas 137, 5655 e a própria 40). É por isso que a aba Bar aparece no Sertão hoje: **o Sertão não tem nenhum `store_user` cadastrado**, todo acesso é pela conta universal. Trocar por uma função que deriva de `resolveStoreModules(store)` — a conta universal continua vendo tudo que a loja tem, e nada do que ela não tem.

- [ ] **Passo 4: Abas somem da navegação**

`navTabs` (`StoreModule.tsx:397-398`) e `bottomNavTabs` (`:404`) filtram por `visibleTabs`. Garantir que uma aba de módulo desligado não aparece nem na sidebar nem na barra inferior, e que a aba ativa cai num módulo válido se a atual sumir.

- [ ] **Passo 5: UI no Master Admin**

Em "Criar Loja" e "Editar Loja" (`AdminModule.tsx`), uma seção "Módulos desta loja" com um toggle por módulo e um seletor de fluxo (`Acompanhamento na tela (KDS)` / `Envia direto para impressão`). Loja nova nasce com tudo ligado e `kds` — igual ao comportamento atual.

- [ ] **Passo 6: `npm run build` limpo, commit**

```
feat(lojas): perfil de modulos por loja, conta universal deixa de ter permissao fixa
```

---

### Task 2: Fluxo `direct_print` — lança, envia, imprime

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`TablesView`, envio do pedido)
- Modify: `lib/print.ts` (ticket por destino, se necessário)

**Interfaces:**
- Consome: `resolveOrderFlow(store)` da Task 1.

- [ ] **Passo 1: Enviar imprime**

Quando `order_flow === 'direct_print'`, enviar o pedido deve, no mesmo gesto: gravar o pedido (caminho atual, `create_order_secure`) e imprimir os tickets — **um por destino**, agrupando os itens `kitchen` num ticket e os `bar` noutro. O Sertão tem 198 produtos `bar` e 192 `kitchen`, então os dois destinos são reais e o agrupamento importa.

Não inventar caminho novo de criação de pedido. É o envio que já existe, mais a impressão.

- [ ] **Passo 2: Nada de acompanhamento**

Nesse fluxo o pedido não deve exigir nenhuma transição manual de status. Verificar o que `create_order_secure`/`send_order_to_kitchen_secure` deixam como status e garantir que o pedido não fica "preso" esperando alguém apertar botão — o pedido nasce enviado.

- [ ] **Passo 3: Histórico do que foi enviado**

Uma lista simples e legível dos pedidos enviados (hora, mesa, itens, destino), acessível para garçom e caixa. É o substituto do KDS: serve para conferir "o pedido já foi?". Sem botões de status, sem colunas de fluxo.

- [ ] **Passo 4: `npm run build` limpo, commit**

```
feat(pedidos): fluxo direto — lancar e enviar imprime o pedido, sem KDS
```

---

### Task 3: Estação de Impressão

**Files:**
- Create: `app/estacao/page.tsx` (ou rota equivalente dentro de `/loja`)
- Modify: `lib/api.ts` (assinatura Realtime de pedidos novos por loja/destino)

- [ ] **Passo 1: Página que imprime sozinha**

Uma página que um aparelho na cozinha (ou no caixa) deixa aberta. Escolhe a loja e o destino (`cozinha` / `bar` / `caixa`), assina os pedidos novos via Realtime e imprime cada um automaticamente, sem clique.

Detalhe que importa: **navegador não imprime sem gesto do usuário** na primeira vez. A página precisa de um botão "Ativar impressão" que o operador clica uma vez ao abrir, e a partir dali imprime sozinha. Documentar isso na tela, não escondido.

- [ ] **Passo 2: Não imprimir duas vezes**

Um pedido já impresso não pode reimprimir num reload nem numa reconexão. Guardar o que já saiu (localStorage por estação é suficiente) e ignorar duplicata.

- [ ] **Passo 3: Estado visível**

A estação mostra claramente: conectada ou não, e o que imprimiu por último. Se a conexão cair, tem que ser óbvio na tela — uma cozinha não pode descobrir que parou de receber pedido pelo cliente reclamando.

- [ ] **Passo 4: `npm run build` limpo, commit**

```
feat(estacao): pagina de estacao de impressao que imprime pedido novo sozinha
```

---

### Task 4: Módulo Caixa

**Files:**
- Modify: `components/modules/StoreModule.tsx` (novo módulo/aba, permissão `caixa`)
- Modify: `lib/labels.ts` (rótulo do papel)
- Modify: `components/modules/AdminModule.tsx` / gestão de usuários (permissão nova)

- [ ] **Passo 1: O caixa vê o que o garçom vê, e mais**

Caixa tem acesso à gestão de mesa igual ao garçom, e é **ele** quem finaliza. O garçom deixa de finalizar: o botão dele vira "Receber conta"/"Pedir conta", e a mesa aparece para o caixa como pedindo conta — do mesmo jeito que já aparece quando o cliente pede.

- [ ] **Passo 2: Finalização com formas de pagamento de verdade**

A tela de finalizar abre grande (a janela grande já existe desde 22/08, `size="lg"` em `Modal`) e oferece formas de pagamento reais: dinheiro com troco, cartão com bandeira, PIX, e **múltiplas formas no mesmo pagamento** (parte no cartão, parte em dinheiro). Não é o seletor simples de hoje.

- [ ] **Passo 3: Conta imprime no caixa**

Ao receber a conta, imprime o comprovante. Com a Estação de Impressão da Task 3 configurada como `caixa`, sai na impressora do caixa.

- [ ] **Passo 4: `npm run build` limpo, commit**

```
feat(caixa): modulo caixa com finalizacao e formas de pagamento multiplas
```

---

### Task 5: Configurar o Sertão e verificar as outras 6

- [ ] **Passo 1: Aplicar o perfil do Sertão**

`kitchen_kds: false`, `bar_kds: false`, `caixa: true`, `order_flow: 'direct_print'`. Pelo Master Admin, não por SQL direto.

- [ ] **Passo 2: Confirmar que as outras 6 não mudaram**

Barraca Boipeba, Vieras e Vinhos e as 4 Donana **não têm** `modules` em `config` e devem continuar com todas as abas e o fluxo KDS. Verificar loja por loja, não por amostragem — é o risco central deste plano.

---

## Fora de escopo (registrado, não fazer aqui)

- **"Remover Taxa" não persiste** — `StoreModule.tsx:1123`/`:1927` só mexem em estado local; `toggleTableServiceFee` (`lib/api.ts:771`) tem zero call sites. Bug real, mexe em dinheiro, precisa de verificação própria.
- **PIN rotativo a cada abre/fecha de mesa** e **jurisdição de mesas por garçom** — itens do backlog, não entram nesta leva.
- **Relatórios** (subprojeto E) e o **painel de saúde das integrações**.
- **CSC de produção do Sertão** — pendência administrativa na SEFAZ, não é código.
