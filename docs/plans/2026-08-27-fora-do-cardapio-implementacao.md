# Fora do Cardápio — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementar o mega plano "Fora do Cardápio" (artifact publicado nesta sessão) — tudo, exceto Pix na mesa e as 2 features de WhatsApp (fidelidade e atendente de IA), que ficam de fora por pedido explícito do usuário.

**Architecture:** Este projeto não tem suíte de testes automatizados (Next.js 16 App Router, sem Jest/Playwright configurado) — toda verificação estabelecida nesta sessão é live, contra o banco de produção real (Contabo, self-hosted), usando a loja de teste **"ZZ Laboratorio (NAO E CLIENTE)"** via `chrome-devtools` MCP. Cada task abaixo troca "rodar teste automatizado" por "verificar ao vivo na ZZ Laboratorio", mantendo o espírito de TDD (specificar o comportamento esperado antes de codar, confirmar depois) sem inventar uma suíte de teste que o projeto não usa.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Supabase self-hosted (Postgres direto via SSH+psql no Contabo), `mcp__higgsfield__*` (geração de imagem por IA, disponível nesta sessão) pra Task 20.

**Fora de escopo (pedido explícito do usuário):** Pix dinâmico na mesa, fidelidade via WhatsApp, atendente de IA no WhatsApp.

---

## Como cada task é verificada (em vez de suíte automatizada)

1. `npm run build` — typecheck limpo, sempre antes de qualquer commit.
2. `npm run dev` local (conecta no banco de PRODUÇÃO real via `.env.local` — nunca testar fluxo que persiste dado fora da ZZ Laboratorio).
3. Login ZZ Laboratorio: `qa-caixa-task4@zz-laboratorio.test` / `TesteCaixa123!`.
4. Testar o fluxo real via `chrome-devtools` MCP (snapshot, click, fill).
5. Limpar qualquer dado de teste criado (mesa aberta, pedido, etc.) antes de encerrar a task.
6. `git commit` com mensagem explicando o quê + por quê (padrão já usado nesta sessão: motivo real, o que foi verificado, `Co-Authored-By`).

---

## Fase 1 — Couvert: personalização que falta (rápido, baixo risco)

### Task 1: Perfil por tipo de casa (presets de módulo)

**Files:**
- Modify: `lib/storeModules.ts` (novo export `STORE_PROFILE_PRESETS`)
- Modify: `components/modules/StoreModule.tsx` (aba Operação — botões de preset acima da grade de módulos)
- Modify: `components/modules/AdminModule.tsx` (mesma UI, Master Admin)

**O que construir:** um `Record` de presets nomeados (`'completo' | 'so_balcao' | 'bar_sem_cozinha' | 'mesa_sem_bar'`), cada um mapeando pra um `StoreModules` + `OrderFlow` completo. Botões acima da grade atual ("Restaurante completo", "Só balcão", "Bar sem cozinha", "Mesa sem bar") que, ao clicar, só ajustam o `useState` local (não salvam sozinhos — o dono ainda revisa e clica "Salvar Operação"/"Salvar Loja" como já faz hoje).

```ts
// lib/storeModules.ts
export const STORE_PROFILE_PRESETS: Record<string, { label: string; modules: StoreModules; orderFlow: OrderFlow }> = {
  completo: { label: 'Restaurante completo', modules: ALL_ON, orderFlow: 'kds' },
  so_balcao: { label: 'Só balcão', modules: { ...ALL_ON, tables: false, kitchen_kds: false, bar_kds: false }, orderFlow: 'direct_print' },
  bar_sem_cozinha: { label: 'Bar sem cozinha', modules: { ...ALL_ON, kitchen_kds: false }, orderFlow: 'kds' },
  mesa_sem_bar: { label: 'Mesa sem bar', modules: { ...ALL_ON, bar_kds: false }, orderFlow: 'kds' },
};
```

**Verificação ao vivo:** ZZ Laboratorio → Administração → Operação → clicar "Só balcão" → confirmar que os switches Mesas/Cozinha/Bar desmarcam sozinhos e Fluxo vira "Envia direto pra impressão" → **não salvar** (só visual) → clicar "Restaurante completo" de novo → confirmar que volta tudo → aí sim salvar o estado original de volta, sem mudar nada de verdade na loja.

**Commit:** `feat(operacao): presets de perfil de loja (completo/balcão/bar/mesa)`

---

### Task 2: Papel com nome de gente (presets de permissão)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`UserManagementView` — formulário de novo usuário)
- Modify: `components/modules/AdminModule.tsx` (mesmo formulário, Master Admin, se existir lá — conferir; hoje equipe só é gerenciada pelo lojista via `UserManagementView`)

**O que construir:** 3 botões de preset acima do formulário de permissões ao CRIAR um usuário novo (nunca ao editar um já existente, pra não sobrescrever configuração manual): "Garçom que só serve" (`tables:true, counter:false, caixa:false`), "Garçom que também recebe" (`tables:true, caixa:true`), "Caixa fixo" (`tables:true, counter:true, caixa:true, kitchen:false, bar:false, menu:false, admin:false`). Clicar um preset só pré-marca os checkboxes existentes — não esconde o formulário nem cria campo novo.

**Verificação ao vivo:** ZZ Laboratorio → Gestão de Usuários → Novo Usuário → clicar "Garçom que também recebe" → confirmar que os checkboxes certos marcam sozinhos → **cancelar sem salvar** (não criar usuário de teste de verdade, ou criar e apagar em seguida).

**Commit:** `feat(usuarios): presets de permissão por função (garçom/caixa)`

---

### Task 3: Checklist de abertura de turno (não só no cadastro da loja)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`CaixaView` — fluxo de "Abrir Caixa")

**Contexto:** o Master Admin já tem esse checklist (aviso se não tem ninguém com permissão Caixa, lembrete de testar impressão) mas só aparece ao CADASTRAR a loja — não no dia a dia, quando o operador real abre o turno. Portar o mesmo aviso pra dentro do modal "Abrir Caixa" quando `resolveOrderFlow(store) === 'direct_print'`.

**O que construir:** dentro do modal de abrir turno (`handleOpenShift`/modal correspondente em `CaixaView`), se a loja for `direct_print`, mostrar um bloco de aviso (mesmo texto/estilo do Master Admin) com: "Teste a impressão antes de abrir" (link/botão que navega pro botão "Testar Impressão" já existente) — não bloqueia abrir o turno, só avisa, mesma filosofia do original.

**Verificação ao vivo:** ZZ Laboratorio (já é `direct_print`) → Caixa → abrir modal de abertura de turno → confirmar que o aviso aparece.

**Commit:** `feat(caixa): checklist de abertura de turno pra loja sem acompanhamento`

---

## Fase 2 — Sala de Controle (Caixa)

### Task 4: Painel "Ver todas as mesas" (não só WAITING_BILL)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`CaixaView`)

**Contexto real (achado pela auditoria desta sessão):** a fila "Aguardando Pagamento" só lista mesa em `WAITING_BILL`. Numa loja `direct_print`, o Caixa não tem NENHUMA visão de quais mesas estão ocupadas comendo agora.

**O que construir:** nova seção "Mesas Ocupadas" acima ou ao lado da fila atual, listando TODAS as mesas com status `OCCUPIED` (não só `WAITING_BILL`): número da mesa, tempo de ocupação (cor: verde <20min, amarelo 20-40min, vermelho >40min — usar os tokens `--ok`/`--warn`/`--err` já existentes), valor corrente da comanda. Reaproveitar os dados que `TablesView` já busca (`fetchActiveOrdersForTables`) — não duplicar query, só uma segunda leitura/exibição na `CaixaView`.

**Verificação ao vivo:** ZZ Laboratorio → abrir 2 mesas com pedidos diferentes → ir na aba Caixa → confirmar que AMBAS aparecem na seção nova, com cor certa conforme o tempo → fechar as mesas → confirmar que somem.

**Commit:** `feat(caixa): painel de mesas ocupadas, não só aguardando pagamento`

---

### Task 5: Fechar em 1 toque

**Files:**
- Modify: `components/modules/StoreModule.tsx` (modal "Receber Pagamento", `TablesView`/`CounterView`)

**O que construir:** logo abaixo dos botões de método de pagamento (Crédito/Débito/PIX/Dinheiro), quando NENHUM pagamento foi lançado ainda, mostrar um botão extra por método com o valor já preenchido: `"Dinheiro • R$ 33,00 • Finalizar"` — um clique só chama a mesma sequência que hoje leva 3 cliques (selecionar método → confirmar valor → adicionar pagamento) e já habilita "Finalizar Mesa". Só aparece quando é o PRIMEIRO pagamento (não em split).

**Verificação ao vivo:** ZZ Laboratorio → abrir mesa, lançar item de R$30 → Receber Pagamento → confirmar que aparece "Dinheiro • R$33,00 • Finalizar" (com taxa) → clicar → confirmar que finaliza em 1 toque.

**Commit:** `feat(caixa): fechamento em 1 toque quando valor bate exato`

---

### Task 6: Modo Rush

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`CaixaView`)

**O que construir:** quando o número de mesas ocupadas simultâneas (do painel da Task 4) passar de um limite configurável (default 6, hardcoded por enquanto — não vale criar campo de configuração pra isso agora), a lista simplifica: mostra só número da mesa + valor + 1 botão "Receber", escondendo detalhe extra (tempo exato, breakdown). Um toggle manual "Modo Rush" também disponível pro operador ligar/desligar na mão, pra não depender só do threshold automático.

**Verificação ao vivo:** ZZ Laboratorio → abrir 7 mesas de teste rápido (ou simular via toggle manual) → confirmar que a lista fica mais densa/simples → fechar as mesas extras depois.

**Commit:** `feat(caixa): modo rush simplifica a visão sob carga alta`

---

## Fase 3 — Especialidade da Casa (com/sem acompanhamento)

### Task 7: Cozinha profissional (timers visuais no KDS)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`KdsView`)

**O que construir:** cada card de item no KDS já tem `prep_time_minutes` (usado hoje só pro indicador de atraso). Adicionar um cronômetro visual (`Xmin` contando desde `created_at`), mudando de cor conforme a proporção decorrida/esperado (verde <70%, amarelo 70-100%, vermelho >100% — atrasado). Som já existe pra pedido novo; adicionar um segundo som (mais urgente/diferente) quando um item cruza pra vermelho pela primeira vez.

**Verificação ao vivo:** ZZ Laboratorio → lançar pedido de item com `prep_time_minutes` baixo (ex.: 1 min, editar no cadastro do produto de teste) → ir no KDS → aguardar passar do tempo → confirmar mudança de cor e som novo.

**Commit:** `feat(kds): cronômetro visual e som de urgência por atraso`

---

### Task 8: A sala de controle também é a cozinha (loja sem acompanhamento)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`CaixaView`)

**O que construir:** reaproveitar o painel da Task 4 ("Mesas Ocupadas") e, quando `resolveOrderFlow(store) === 'direct_print'`, adicionar por mesa a lista dos itens ainda não impressos/entregues (mesmo dado que `CaixaPrintStation` já rastreia) — dá pro caixa de uma loja sem KDS a mesma sensação de "eu sei o que tá sendo preparado agora" que uma loja com KDS já tem.

**Verificação ao vivo:** ZZ Laboratorio (já é `direct_print`) → lançar item → confirmar que aparece na lista de "não entregue ainda" dentro do painel de mesas ocupadas → marcar como impresso/entregue → confirmar que some da lista.

**Commit:** `feat(caixa): visão de itens pendentes por mesa em loja sem acompanhamento`

---

### Task 9: Escala inteligente de mesa

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`TablesView` — ao abrir uma mesa nova/atribuir garçom)

**O que construir:** ao abrir uma mesa sem jurisdição definida (ou ao trocar responsável), mostrar ao lado de cada garçom disponível quantas mesas ele já tem ativas agora (`assigned_table_ids` cruzado com mesas `OCCUPIED`), ordenando a lista do menos ocupado pro mais ocupado. Sugestão visual, não automática — o operador ainda escolhe.

**Verificação ao vivo:** ZZ Laboratorio → criar 2 usuários garçom de teste com jurisdições diferentes → abrir mesa → confirmar que a lista de "Trocar Responsável" mostra contagem de mesas ativas por garçom, ordenada certo → apagar os usuários de teste depois.

**Commit:** `feat(mesas): sugestão de garçom por carga de mesas ativas`

---

### Task 10: Jurisdição de mesa por turno (ligada ao ponto)

**Files:**
- Modify: `lib/storeModules.ts` (`isTableInJurisdiction` — ou nova função)
- Modify: `components/modules/StoreModule.tsx` (`TablesView`)

**O que construir:** hoje `assigned_table_ids` é estático (nunca muda sozinho). Adicionar uma regra opcional: garçom só aparece como "disponível" pra atribuição (Task 9) enquanto tiver um ponto aberto (`fetchOpenCheckin`, já existe da Fase 4 anterior desta sessão). Não remove jurisdição de quem já está atribuído a uma mesa em andamento — só afeta sugestão de NOVA atribuição.

**Verificação ao vivo:** ZZ Laboratorio → bater ponto como QA Caixa → confirmar que aparece como "disponível" na sugestão da Task 9 → encerrar o ponto → confirmar que some da lista de sugestão (mas mesas já atribuídas continuam funcionando normalmente).

**Commit:** `feat(mesas): sugestão de garçom só considera quem bateu ponto`

---

## Fase 4 — Torre de Controle (dono/gerente)

### Task 11: "O que já é seu, visível de longe" (resumo consolidado)

**Files:**
- Modify: `components/modules/StoreDashboardView.tsx`

**O que construir:** card novo no topo do Dashboard, "Hoje na loja": quem bateu ponto e está trabalhando agora (via `fetchCheckinsHistory`, filtro `checkout_at is null`), qual o turno de caixa atual (`fetchOpenCashShift`), e um link direto pra aba Operador do histórico de vendas. Não é dado novo — é reunir 3 chamadas que já existem numa tela só.

**Verificação ao vivo:** ZZ Laboratorio → bater ponto → abrir Dashboard → confirmar que aparece "QA Caixa (trabalhando)" no card novo.

**Commit:** `feat(dashboard): card "hoje na loja" consolidando ponto e turno de caixa`

---

### Task 12: Alertas que avisam antes

**Files:**
- Modify: `components/modules/StoreDashboardView.tsx`

**O que construir:** 3 alertas calculados no client a partir de dado já buscado pelo Dashboard (sem RPC nova): "Mesa X sem pedido novo há mais de 40min" (comparar `updated_at` da mesa ocupada), "Cancelamento acima do normal hoje" (comparar `% de itens cancelados hoje` vs média dos últimos 7 dias), "Produto sem venda nas últimas 2 semanas mas com estoque considerável" — este último fica de fora por depender de dado de estoque que não está disponível aqui; manter só os 2 primeiros.

**Verificação ao vivo:** ZZ Laboratorio → deixar uma mesa aberta parada (sem interagir) → recarregar Dashboard depois de simular passagem de tempo (ajustar `updated_at` via SQL de teste, se necessário) → confirmar que o alerta aparece.

**Commit:** `feat(dashboard): alertas de mesa parada e cancelamento acima do normal`

---

### Task 13: Painel ao vivo (mapa de calor + funil)

**Files:**
- Modify: `components/modules/StoreDashboardView.tsx`

**Escopo reduzido de propósito** (a versão completa do plano — previsão de rush por histórico — fica de fora por exigir um modelo estatístico que este projeto não tem e não deveria inventar às pressas): implementar só o mapa de calor de ocupação por hora (o gráfico "Ocupação por hora do dia" já existe — adicionar uma versão por DIA DA SEMANA também, cruzando os dois eixos) e o funil simples "mesas abertas → mesas com pedido → mesas fechadas com pagamento" no período filtrado.

**Verificação ao vivo:** ZZ Laboratorio → Dashboard → confirmar que o novo gráfico de calor por dia da semana renderiza com o histórico de vendas já existente (é dado real da loja de teste, sem precisar gerar nada novo).

**Commit:** `feat(dashboard): mapa de calor por dia da semana e funil de conversão`

---

### Task 14: Uma rede, uma visão (multi-loja)

**Files:**
- Modify: `components/modules/AdminModule.tsx` (só Master Admin — decisão de escopo abaixo)

**Decisão de escopo:** a versão completa (dono compara lojas lado a lado dentro do PRÓPRIO painel do lojista) exigiria a conta universal ganhar uma visão multi-loja nova — grande o bastante pra merecer uma spec própria depois. A versão que cabe aqui: dentro do Master Admin (que já lista todas as lojas), adicionar uma coluna de faturamento do dia por loja na própria listagem, permitindo comparar Donana Brotas/Praia do Forte/Rio Vermelho/Vilas do Atlântico numa export CSV agrupável — não uma tela nova, só enriquecer a lista existente.

**Verificação ao vivo:** Master Admin → listagem de lojas → confirmar que a coluna de faturamento do dia aparece e bate com o Dashboard de cada loja individualmente.

**Commit:** `feat(admin): faturamento do dia na listagem de lojas do Master Admin`

---

## Fase 5 — Entradas (cardápio do cliente)

### Task 15: Resgatar a carta de vinhos

**Files:**
- Read first: `app/globals.css`, `components/modules/ClientModule.tsx` (todos os usos de `WINE_GOLD`/medalhão)

**O que construir:** auditoria + correção de consistência (não é feature nova) — achar todo lugar onde a identidade "carta de vinhos" foi abandonada pela metade (ex.: telas de split, algum estado de erro) e aplicar o mesmo padrão visual (medalhão, dourado, tipografia editorial) que já existe no cardápio principal.

**Verificação ao vivo:** navegar o cardápio do cliente (`/c/[slug]` da ZZ Laboratorio se tiver produto de teste, ou de uma loja real só pra OLHAR, sem interagir) por TODAS as telas (login, produto, split, checkout) e confirmar consistência visual.

**Commit:** `fix(cliente): consistência da identidade "carta de vinhos" em todas as telas`

---

### Task 16: O prato tem uma história

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`MenuManagementView` — formulário de produto)
- Modify: `components/modules/ClientModule.tsx` (`ProductModal`)

**Contexto:** `products.description` já existe (usado hoje só na busca). Mudar o rótulo do campo no formulário de "Descrição" pra "Descrição (opcional) — conte a história desse prato: origem, por que é especial, há quanto tempo está no cardápio" e exibir com mais destaque tipográfico no `ProductModal` (hoje provavelmente aparece pequeno/secundário — conferir e ajustar).

**Verificação ao vivo:** ZZ Laboratorio → editar produto de teste, preencher descrição → abrir cardápio do cliente → confirmar que aparece com destaque no modal do produto.

**Commit:** `feat(cardapio): descrição do produto vira "história do prato" no modal`

---

### Task 17: Sem conta, com memória

**Files:**
- Modify: `components/modules/ClientModule.tsx`

**O que construir:** usando o mesmo `localStorage` já usado pra favoritos (`fav_products_${storeId}`), adicionar uma chave `visit_count_${storeId}` incrementada a cada carregamento do cardápio (throttle de 1x por dia por `storeId`, usando `Date` gravada junto). A partir de 3 visitas, mostrar um badge discreto "Você já esteve aqui Xx" perto do cabeçalho. Zero backend novo, zero conta.

**Verificação ao vivo:** abrir o cardápio do cliente da ZZ Laboratorio 3x (limpando o throttle manualmente via devtools entre cada uma) → confirmar que o badge aparece na 3ª.

**Commit:** `feat(cliente): reconhece visita recorrente sem exigir conta`

---

### Task 18: Cada casa com a própria cara (kit de identidade)

**Files:**
- Modify: `app/globals.css` (novos tokens de tema, ex.: `--theme-font-display`)
- Modify: `components/modules/ClientModule.tsx` (aplicar tema resolvido)
- Modify: `components/modules/StoreModule.tsx` (`MenuManagementView` — seletor de preset)
- Modify: `lib/api.ts` (`updateStoreConfig` já serve — só um novo campo `theme_preset` em `stores.config`)

**Escopo reduzido de propósito:** não um editor livre de tema (grande demais pra esta rodada) — 4 presets fechados (`'classico'` = o que existe hoje, `'pizzaria'`, `'boteco'`, `'praia'`), cada um mudando só a fonte de destaque + 1 imagem de textura de fundo sutil (SVG inline, sem upload de arquivo) + o emoji/ícone default de categoria. Reaproveita a mesma lógica de `accent_color` já existente (fallback pro clássico se não configurado).

**Verificação ao vivo:** ZZ Laboratorio → Cardápio → escolher preset "Pizzaria" → abrir `/c/[slug]` → confirmar mudança visual → voltar pro "Clássico".

**Commit:** `feat(cardapio): 4 presets de identidade visual por loja`

---

### Task 19: Cardápio de verdade no bolso (PWA + push real)

**Files:**
- Modify: `public/manifest.json`
- Create: `public/sw.js` (service worker)
- Create: `app/api/push/subscribe/route.ts`, `app/api/push/send/route.ts`
- Modify: `components/modules/ClientModule.tsx` (registro do service worker + pedido de permissão)

**Decisão que precisa de confirmação antes de codar:** push real exige VAPID keys (par de chaves pública/privada geradas uma vez pro projeto) e uma tabela nova (`push_subscriptions`, guardando o endpoint do navegador por sessão de cliente). Isso é a PRIMEIRA infraestrutura de notificação push de verdade do projeto — vale gerar as chaves e aplicar a migration antes de escrever o resto. **Não seguir esta task sem confirmar a geração das chaves VAPID com o usuário primeiro** (é uma credencial nova do projeto, mesmo nível de cuidado já usado pra outras chaves deste sistema).

**Verificação ao vivo:** instalar o PWA da ZZ Laboratorio num Chrome real (ícone na tela), aceitar notificação, fechar a aba, mudar status de um pedido de teste via garçom, confirmar que a notificação chega mesmo com o app fechado.

**Commit:** `feat(pwa): push notification real via service worker + VAPID`

---

### Task 20: Fotos que nunca existiram (IA gerando imagem de produto)

**Files:**
- Modify: `components/modules/StoreModule.tsx` (`MenuManagementView` — botão "Gerar foto com IA" no formulário de produto)
- Modify: `lib/api.ts` (nova função `generateProductImage`)

**O que construir:** usando a ferramenta de geração de imagem já disponível nesta sessão (`mcp__higgsfield__generate_image`) NÃO é chamável direto do app em produção (é uma ferramenta deste ambiente de trabalho, não uma API que o Next.js do cliente pode chamar) — então esta task real é: (a) desenhar o prompt-template (nome do produto + categoria + tags → prompt em inglês, sem mencionar marca/pessoa real), (b) um botão "Gerar foto com IA" no formulário de produto que, POR ENQUANTO (sem integração de API própria do projeto), abre um fluxo assistido onde o Claude (nesta sessão ou em outra) gera a imagem via `mcp__higgsfield__*`, faz upload pro Storage já existente (`uploadProductImage`, já usado pra upload manual) e associa ao produto. Uma integração de API de geração de imagem RODANDO DENTRO do Next.js em produção (sem depender de uma sessão do Claude) é um projeto à parte, que exigiria escolher e pagar por um provedor de imagem (ex.: OpenAI, Stability, Fal) — não decidir isso sem o usuário escolher o provedor e fornecer a chave.

**Verificação ao vivo:** gerar 1 imagem de teste pra um produto real sem foto na ZZ Laboratorio via `mcp__higgsfield__generate_image`, subir via `uploadProductImage`, confirmar que aparece no cardápio do cliente — prova o pipeline manual funciona; a automação completa fica registrada como próximo passo, não implementada nesta rodada.

**Commit:** `feat(cardapio): pipeline assistido de foto por IA pra produto sem imagem`

---

## Fora do Cardápio (mantido, exceto Pix/WhatsApp)

### Task 21: Reserva de mesa direto do cardápio

**Files:**
- Create: `supabase/migrations/058_reserva_de_mesa.sql`
- Modify: `components/modules/ClientModule.tsx` (novo fluxo "Reservar")
- Modify: `components/modules/StoreModule.tsx` (`TablesView` — ver reservas do dia)
- Modify: `lib/api.ts` (`createReservation`, `fetchReservationsByStore`)

**O que construir (MVP real, não o produto completo):** tabela nova `table_reservations` (store_id, customer_name, customer_phone, party_size, reserved_for, status `'pending'|'confirmed'|'canceled'`, created_at). Cliente acessa o mesmo link do cardápio, escolhe "Reservar" em vez de "Fazer Pedido", preenche nome/telefone/horário/pessoas — sem escolher mesa específica (isso é decisão do lojista no dia). Lojista vê a lista de reservas do dia na aba Mesas, confirma ou cancela manualmente. Não inclui: confirmação automática por SMS/WhatsApp (fora de escopo), bloqueio automático de mesa (a mesa continua sendo aberta manualmente como hoje).

**Verificação ao vivo:** ZZ Laboratorio → acessar `/c/zz-laboratorio` → criar reserva de teste → conferir que aparece na lista do lojista → confirmar/cancelar → apagar a reserva de teste do banco depois.

**Commit:** `feat(reserva): reserva de mesa direto do cardápio (MVP sem confirmação automática)`

---

## Ordem de execução recomendada

Fases 1→2→3→4→5 nessa ordem (dependências reais: Task 8 depende da 4; Task 10 depende do ponto, já existente; Task 18 é independente e pode ser paralela). Dentro de cada fase, tasks são independentes entre si — podem ser feitas fora de ordem sem quebrar nada.

**Duas tasks têm um bloqueio real que não dá pra resolver sozinho, marcado explicitamente acima:**
- **Task 19** (push real) precisa gerar VAPID keys — credencial nova do projeto, confirmar com o usuário antes.
- **Task 20** (fotos por IA) não tem, hoje, um caminho de rodar 100% automatizado dentro do Next.js em produção sem escolher e pagar por um provedor — a versão desta rodada é o pipeline assistido manual, não a automação completa.

Todo o resto (Tasks 1-18, 21) é implementável de ponta a ponta nesta sessão, sem decisão pendente.
