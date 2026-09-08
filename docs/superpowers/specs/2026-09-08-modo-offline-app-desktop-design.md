# Modo Offline do App Desktop — design

## Contexto e objetivo

Sub-projeto 3 do plano original de "app Windows funcional" (ver
`docs/superpowers/specs/2026-09-07-desktop-app-electron-design.md`),
adiado até agora — sub-projeto 1 (casca desktop) e 2 (hardware/impressora)
já resolvidos. Motivado por um caso real: o Ramon (loja "O Sertão Vai
Virar Mar") testou o app **de propósito sem internet**, esperando
conseguir abrir mesa e lançar pedido pra impressora conectada via cabo, e
recebeu erro — porque hoje o app inteiro depende de rede pra qualquer
operação (login, cardápio, mesas, pedido — tudo passa por `lib/api.ts`
chamando RPCs do Supabase self-hosted, que fica num servidor remoto, o
Contabo, não no PC da loja).

**Objetivo**: o app funcionar de ponta a ponta sem internet — login (já
feito antes de cair a conexão), ver cardápio/mesas, lançar pedido,
avançar status, imprimir, fechar conta, abrir/fechar caixa — e
sincronizar tudo sozinho assim que a conexão voltar, sem a pessoa ter que
fazer nada manual.

## Escopo

**Dentro:**
- App desktop Electron (não o site normal no navegador — ver "Por que só
  desktop" abaixo).
- Login com sessão já cacheada localmente (não é possível logar pela
  PRIMEIRA vez sem internet — precisa buscar a senha do banco pelo menos
  uma vez).
- Cardápio, mesas, config da loja: disponíveis a partir do último
  carregamento bem-sucedido, mesmo sem internet.
- Ações offline: lançar pedido (mesa e balcão), avançar status no KDS,
  fechar conta (mesa/balcão), abrir/fechar turno de caixa, sangria/
  suprimento.
- Impressão: já funciona sem depender de internet hoje (é local ao PC/
  rede da loja) — não muda, só deixa de ser bloqueada por uma ação
  anterior (lançar pedido) que dependia de rede.
- Indicador visual de status (online/offline, quantas ações pendentes).
- Sincronização automática assim que a conexão volta, sem intervenção
  manual.

**Fora (explicitamente):**
- Cardápio do cliente (`/c/[slug]`, QR code) — nunca entra no app
  desktop (decisão já registrada no spec da casca desktop), não precisa
  de offline.
- Emissão de nota fiscal (NFC-e/NF-e) **durante** o período offline —
  depende da SEFAZ, um serviço do governo fora do nosso controle,
  fisicamente impossível de funcionar sem internet não importa o que
  construamos aqui. Decisão do usuário: a venda fecha normalmente
  offline, e a nota é emitida automaticamente assim que a internet
  voltar (mesmo mecanismo fire-and-forget que já existe hoje,
  `triggerEmissaoFiscal`, só passa a rodar no momento da sincronização
  em vez de no momento do fechamento).
- Dashboard/Histórico de Vendas offline — são consultas ao banco
  (agregações, filtros de período) que não fazem sentido cachear
  inteiras; ficam desabilitadas (ou mostrando só o que já teria sido
  cacheado antes de cair a conexão) enquanto offline.
- Login pela primeira vez sem nunca ter tido internet — impossível por
  definição (não há senha nenhuma cacheada ainda).
- Múltiplos terminais **editando a mesma mesa ao mesmo tempo** — fora de
  escopo por regra de negócio já confirmada (nunca dois garçons na mesma
  mesa), não por limitação técnica não resolvida.

## Por que só o app desktop, não o site no navegador

O modo offline depende de o navegador continuar aberto no MESMO
computador/aba pelo tempo todo (o cache e a fila vivem em memória do
navegador via IndexedDB, que é por origem/perfil). Isso é exatamente o
comportamento natural de um app desktop instalado (uma janela fixa,
sempre a mesma), mas não é garantido no navegador comum (o funcionário
pode fechar a aba, trocar de dispositivo, etc.) — por isso o modo
offline é uma funcionalidade do app desktop, não do site.

## Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│  App Electron (mesmo de sempre, ver spec da casca desktop)   │
│                                                                │
│  lib/api.ts (camada única de acesso a dado, já existe)        │
│    │                                                          │
│    ├─ navigator.onLine === true (ou checagem ativa) ──────────┼──> RPC direto no Supabase (comportamento de hoje, sem mudança)
│    │                                                          │
│    └─ offline ─────────┐                                      │
│                         ▼                                     │
│              lib/offline/store.ts (IndexedDB)                 │
│              - cardápio, mesas, config, sessão cacheados       │
│              - update otimista na hora (tela reflete já)       │
│                         │                                     │
│                         ▼                                     │
│              lib/offline/queue.ts (IndexedDB)                 │
│              - fila de ações pendentes, em ordem               │
│                                                                │
│  lib/offline/sync.ts                                          │
│    - 'online' event + polling leve de verificação ativa        │
│    - ao reconectar: reproduz a fila em ordem contra as         │
│      MESMAS RPCs que já existem (create_order_secure,          │
│      update_order_item_status_secure, close_table_orders_      │
│      secure, open_cash_shift_secure etc.) — nenhuma lógica      │
│      de negócio nova no banco.                                 │
└──────────────────────────────────────────────────────────────┘
```

**Por que IndexedDB, não SQLite**: o código atual já trata todo dado
como listas simples manipuladas em JavaScript (`fetchMenu` devolve
categorias+produtos já montados, `TablesView` busca mesas+pedidos ativos
e junta em memória) — não há consulta SQL relacional complexa em lugar
nenhum do client. IndexedDB (via a lib `idb`, um wrapper fino, sem
dependência nativa) cobre esse padrão sem exigir compilar um módulo
nativo por instalação do Electron (risco real de build que SQLite
introduziria, visto no próprio pipeline de build do app desktop hoje).

## Componentes novos

### `lib/offline/store.ts`
Cache local via IndexedDB. Guarda, por loja:
- Cardápio completo (categorias + produtos + opções) — atualizado a
  cada `fetchMenu` bem-sucedido online.
- Mesas + pedidos ativos — atualizado a cada carregamento bem-sucedido
  de `fetchTables`/`fetchActiveOrdersForTables`.
- Config da loja (`stores.config`, taxa de serviço, etc.).
- Sessão de login (já existe hoje via `localStorage` — continua lá,
  não precisa duplicar).

Funções: `getCachedMenu(storeId)`, `setCachedMenu(storeId, data)`,
`getCachedTables(storeId)`, `setCachedTables(storeId, data)`, e
equivalentes pra config. Toda função de leitura em `lib/api.ts` que já
existe (`fetchMenu`, `fetchTables`, `fetchActiveOrdersForTables`) grava
no cache **sempre que tem sucesso online**, sem exceção — o cache "some
antigo é melhor que sem dado nenhum" nunca precisa de um caminho de
código separado pra "modo offline explícito".

### `lib/offline/queue.ts`
Fila de ações pendentes, persistida em IndexedDB (sobrevive a fechar/
reabrir o app). Cada entrada:
```ts
type QueuedAction = {
  id: string; // uuid gerado no client, usado como idempotency key
  type: 'create_order' | 'update_order_item_status' | 'close_table_session'
      | 'close_counter_order' | 'open_cash_shift' | 'close_cash_shift'
      | 'register_cash_movement';
  payload: Record<string, unknown>; // mesmos argumentos que a função real de lib/api.ts já recebe
  createdAt: number;
  attempts: number;
  lastError?: string;
};
```
Funções: `enqueue(action)`, `getPendingActions()`, `markDone(id)`,
`markFailed(id, error)`, `countPending()`.

### Interceptação em `lib/api.ts`
Cada função de escrita relevante (lista abaixo) ganha uma checagem no
topo: se `navigator.onLine` for `false` (ou a última tentativa de rede
tiver falhado por timeout/conexão — não só o sinalizador do navegador,
que pode estar errado em rede capturada/proxy quebrado), a função:
1. Aplica a mudança **otimisticamente** no cache local (`lib/offline/store.ts`)
   — a tela do usuário reflete a ação IMEDIATAMENTE, como se tivesse
   dado certo (mesmo princípio de update otimista já usado em vários
   lugares do código hoje, ex. `KdsView.advanceStatus`).
2. Enfileira a ação real via `enqueue()`.
3. Devolve sucesso pro caller (o mesmo formato `{success: true, ...}`
   que a função já devolve hoje), gerando um ID local temporário quando
   a função original devolveria um ID gerado pelo banco (ex.
   `createOrder` → `orderId` local prefixado, ex. `local_<uuid>`,
   trocado pelo ID real do banco quando a fila sincronizar).

Funções que ganham este comportamento (mapeadas às RPCs que já
existem, nenhuma RPC nova):
- `createOrder` → `create_order_secure`
- `updateOrderItemStatus` → `update_order_item_status_secure`
- `closeTableSession` → `close_table_orders_secure` (+ o fluxo de
  emissão fiscal, adiado — ver seção de nota fiscal)
- `closeCounterOrder` → `close_counter_order_secure`
- `openCashShift` → `open_cash_shift_secure`
- `closeCashShift` → `close_cash_shift_secure`
- `registerCashMovement` (sangria/suprimento) → `register_cash_movement_secure`

Funções de LEITURA (`fetchMenu`, `fetchTables`,
`fetchActiveOrdersForTables`, `fetchOpenCashShift` etc.) ganham só o
comportamento de fallback: se a chamada de rede falhar, devolvem o
último valor cacheado em vez de erro/lista vazia — sem enfileirar nada
(leitura não tem efeito colateral pra sincronizar depois).

### `lib/offline/sync.ts`
- Escuta `window.addEventListener('online', ...)` E faz uma verificação
  ativa periódica (ex. a cada 30s, um `fetch` leve contra o próprio
  servidor) — `navigator.onLine` sozinho não é confiável (fica `true`
  em rede conectada mas sem internet de verdade, ex. Wi-Fi sem acesso
  externo).
- Ao confirmar conexão real: processa a fila em ORDEM (mais antiga
  primeiro), uma ação de cada vez (não em paralelo — evita condição de
  corrida entre ações da mesma mesa, ex. lançar item e fechar conta
  fora de ordem).
- Cada ação processada chama a MESMA função de `lib/api.ts` que seria
  chamada originalmente (sem duplicar a lógica de payload/RPC).
- Erro de uma ação específica (ex. mesa já fechada por outro caminho
  entre o momento offline e a sincronização — cenário raro dado que
  "nunca dois garçons na mesma mesa", mas possível) marca essa ação como
  falha (`markFailed`, incrementa `attempts`) e **não trava as ações
  seguintes da fila** — cada uma é independente.
- Depois de 3 tentativas falhas na mesma ação, para de tentar
  automaticamente e sinaliza no indicador visual (ver abaixo) pra
  intervenção manual — nunca falha silenciosamente pra sempre.
- IDs locais temporários (`local_<uuid>`) são substituídos pelo ID real
  assim que a ação de criação sincroniza — qualquer ação da fila que
  referencia esse ID (ex. avançar status de um item de um pedido criado
  offline) precisa resolver o ID real antes de disparar, mantendo um
  mapa local `local_id → real_id` durante a sessão de sincronização.

### Nota fiscal
`triggerEmissaoFiscal` (já existe, fire-and-forget) continua exatamente
igual — só passa a ser chamada no momento em que a ação `close_table_session`/
`close_counter_order` da fila sincroniza de verdade, não no momento em
que o usuário clicou offline. Nenhuma mudança na função em si.

### Indicador visual
Reaproveita o espaço do indicador de impressão já existente
(`CaixaPrintStationIndicator`, no header do painel) — um segundo badge
ao lado: "🟢 Sincronizado" (online, fila vazia), "🟡 Offline — N
pendente(s)" (offline, fila com itens), "🔴 N falha(s) — verificar"
(sincronizando mas com ações que já tentaram 3x e falharam).

## Testes

Sem suíte automatizada neste projeto (padrão já documentado). Verificação
por task, ao vivo, no app desktop rodando localmente:
1. Desligar a internet do computador (ou usar as DevTools do Electron,
   aba Network, "Offline") com o app já logado e cardápio/mesas já
   carregados.
2. Lançar um pedido novo numa mesa — confirmar que aparece na tela na
   hora e que o ticket imprime (impressão já não depende de rede).
3. Fechar a conta dessa mesa — confirmar que a mesa libera na tela.
4. Religar a internet — confirmar que o pedido e o fechamento aparecem
   no banco real em segundos, sem clicar em nada.
5. Repetir com abrir/fechar caixa e um item no KDS avançando de status.
6. Testar o caso de falha real: criar uma situação em que uma ação da
   fila falhe de propósito (ex. mesa que não existe mais) e confirmar
   que as ações seguintes da fila sincronizam mesmo assim, e que o
   indicador mostra a falha.

## Fora de escopo (registrado, não esquecido)

- Sincronização bidirecional complexa (dois terminais offline ao mesmo
  tempo editando dados que colidem) — decisão de negócio já elimina
  esse cenário (nunca dois garçons na mesma mesa).
- Cache de Dashboard/Histórico de Vendas — não faz sentido, são
  agregações de banco, não dado bruto que cabe cachear inteiro.
- Modo offline no site normal (navegador) — arquiteturalmente amarrado
  ao app desktop, ver seção "Por que só desktop" acima.
