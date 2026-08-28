# Melhorias no fluxo de Caixa (conferência, auditoria, ponto)

Data: 2026-08-28
Status: aprovado, aguardando plano de implementação

## Contexto

O "caixa por operador" (migration 062, mesma data) resolveu o problema estrutural
de responsabilização — cada login agora abre o próprio turno, em vez de um turno
único compartilhado por loja. Isso valida, sem querer, a prática nº1 encontrada na
pesquisa de mercado feita pra esta spec: **"um caixa, uma gaveta, um turno" é
quase universal** entre sistemas de PDV reais (Square, Toast, Loyverse) —
misturar responsabilidade entre operadores no mesmo turno mata a auditabilidade.

Pedido direto do dono (2026-08-28, ao vivo): melhorar o fluxo inteiro em torno de
4 prioridades, todas escolhidas: **perda/erro de dinheiro**, **visibilidade
gerencial**, **fricção no dia a dia**, e **ligar ponto + caixa** (hoje totalmente
independentes — ver `operator_checkins`, migration 056, comentário explícito "não
tem nada a ver com cash_shifts").

Pesquisa (Toast, Loyverse, Square, práticas brasileiras — Conta Azul, GestãoClick,
Saipos) trouxe 4 achados concretos e baratos de implementar, cada um endereçando
uma das prioridades:

1. **Contagem cega** (Loyverse): não é uma feature nova, é uma *permissão* — quem
   não tem a permissão só vê o campo "valor contado" no fechamento, nunca o
   "esperado" calculado pelo sistema, evitando a tentação de "ajustar pra bater".
2. **Breakdown por cédula/moeda**: contar quantidade de cada nota/moeda em vez de
   somar de cabeça — menos erro, e vira registro auditável de como se chegou
   naquele total.
3. **Tolerância em 2 níveis** (Toast): diferença pequena só avisa; diferença
   grande **bloqueia o fechamento até aprovação de um supervisor**.
4. **Ponto ↔ caixa, integração leve, nunca travamento duro**: bater ponto de
   ENTRADA oferece abrir o caixa junto (Quantic); bater ponto de SAÍDA lembra de
   fechar o caixa antes de sair, sem impedir a saída se o operador ignorar
   (Toast, "Shift Review").

## Decisões já tomadas com o usuário

1. **Abordagem incremental**, não reconstrução do fluxo como assistente guiado —
   evolui `cash_shifts`/`cash_movements`/`operator_checkins` existentes, sem
   trocar a arquitetura.
2. **Nunca travar de verdade o ponto por causa do caixa** — o lembrete no
   checkout é sempre dispensável. Trava de verdade só existe no PRÓPRIO
   fechamento de caixa (tolerância máxima sem aprovação).
3. **Um novo tipo de permissão** (`supervisiona_caixa`) cobre tanto "vê o
   esperado antes de contar" quanto "aprova fechamento com diferença grande" —
   um único conceito (supervisão de caixa), não dois. Owner/universal sempre têm
   esse poder implicitamente, igual a todo outro bypass já existente no projeto
   (`canFinalizeBill`, etc.).
4. **"Desconto" e "gaveta física sem venda" ficam fora desta fase** — o produto
   não tem feature de desconto hoje, e não há integração com hardware de gaveta
   (a gaveta é física, sem sensor). A trilha de auditoria cobre o que já existe
   de fato: cancelamento de item e sangria acima de um valor configurável.

## Escopo desta fase

Dentro: contagem cega opcional por permissão, breakdown por cédula/moeda no
fechamento, tolerância configurável em 2 níveis com aprovação de supervisor,
trilha de auditoria (cancelamento de item + sangria grande) por operador, extensão
do relatório "histórico por operador" com essa trilha, e o hook leve entre bater
ponto e abrir/lembrar de fechar caixa.

Fora de escopo (não pedido, cada um vira spec própria se/quando for a vez):

- Feature de desconto (não existe hoje).
- Qualquer integração com hardware de gaveta física (sensor de abertura).
- "Floating till"/turno compartilhado entre terminais — decidido explicitamente
  contra, na linha da pesquisa ("um caixa, uma gaveta, um turno").
- Sistema de planos contratados (mencionado pelo dono como ideia relacionada,
  mas separado — ver `AGENTS.md`, seção "Configurar operação da loja é
  EXCLUSIVO do Master Admin", já resolvido à parte no mesmo dia).

## Arquitetura

### Modelo de dados

- **`store_users.permissions`**: nova chave `supervisiona_caixa: boolean`
  (ausência = `false`, mesmo padrão estrito já usado por `caixa` — nunca o
  fallback permissivo usado pelas 6 permissões antigas). Concede: ver o valor
  esperado no fechamento do PRÓPRIO turno mesmo com contagem cega ligada na
  loja, e aprovar o fechamento de QUALQUER operador quando a diferença passa da
  tolerância máxima. Editável em "Gestão de Usuários" (mesmo grid de switches
  que já lista `tables`/`counter`/`kitchen`/`bar`/`menu`/`admin`/`caixa`).

- **`stores.config`**: 3 novas chaves (mesmo padrão jsonb de
  `service_fee_rate`/`note_suggestions`, editável pelo lojista em
  "Configurações Gerais", sem migração de coluna):
  - `cash_shift_blind_count: boolean` (default `false` — comportamento atual
    preservado até a loja ligar explicitamente).
  - `cash_shift_warning_tolerance: number` (reais, default `5`).
  - `cash_shift_max_tolerance: number` (reais, default `20` — deve ser `>=`
    warning, validado no client).
  - `cash_shift_sangria_alert_threshold: number` (reais, default `200`) — valor
    de sangria a partir do qual vira evento de auditoria (independente da
    tolerância de fechamento, que é sobre diferença de caixa, não sobre
    tamanho de sangria individual).

- **`cash_shifts`**: 2 novas colunas.
  - `closing_cash_breakdown jsonb null` — `{ "200": 3, "100": 5, "50": 0, ... }`
    (chave = valor da cédula/moeda em string, valor = quantidade). Guardado só
    de forma informativa/auditável; `closing_counted_cash` continua sendo a
    soma (client calcula e envia os dois, `close_cash_shift_secure` não
    recalcula a partir do breakdown — mesmo princípio de "client não dita
    preço" não se aplica aqui, não há valor financeiro sendo cobrado de
    terceiro, é conferência interna).
  - `approved_by_user_id uuid null references store_users(id) on delete set
    null` — preenchido só quando o fechamento precisou de aprovação
    (diferença > `cash_shift_max_tolerance`).

- **Nova tabela `cash_shift_audit_events`**:
  ```sql
  create table cash_shift_audit_events (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references stores(id) on delete cascade,
    shift_id uuid references cash_shifts(id) on delete set null,
    operator_user_id uuid references store_users(id) on delete set null,
    operator_name text not null,  -- denormalizado, mesmo padrão de payment_details.operador_nome (resiliente a usuário excluído depois)
    event_type text not null check (event_type in ('item_cancelado', 'sangria_grande')),
    details jsonb not null default '{}',  -- ex: {"produto": "X-Bacon", "valor": 24.9} ou {"valor": 300, "motivo": "..."}
    created_at timestamptz not null default now()
  );
  ```
  RLS: `select using (false)`, mesmo nível de sensibilidade de `cash_shifts` —
  toda leitura via RPC `security definer` (é dado potencialmente sensível pra
  investigação de fraude, não deveria vazar pela chave anônima).

### RPCs novas/alteradas

- **`cancel_order_item_secure`** (migration 021) ganha `p_operator_user_id uuid
  default null` e `p_operator_name text default null` — **precisa de `DROP
  FUNCTION IF EXISTS` antes do `CREATE`** (lição já documentada 2x neste
  projeto — migrations 052 e 062 — CREATE OR REPLACE com parâmetro extra no
  fim, mesmo com default, cria overload novo em vez de substituir). Quando os
  dois vêm preenchidos, insere uma linha em `cash_shift_audit_events`
  (`event_type = 'item_cancelado'`) dentro da mesma function — nunca uma
  segunda chamada do client, pra não perder o evento se a conexão cair entre
  as duas. `lib/api.ts` `cancelSpecificOrderItem` ganha os 2 parâmetros novos,
  os call sites em `StoreModule.tsx` (que já têm `loggedUser` em escopo)
  passam `loggedUser.id`/`loggedUser.name`.
- **`register_cash_movement_secure`** (migration 051) — mesmo tratamento:
  ganha `p_operator_name text default null` e `p_alert_threshold numeric
  default null` (client sempre passa `stores.config.cash_shift_sangria_alert_threshold`,
  já resolvido no client no momento da chamada — a RPC não lê `stores.config`
  sozinha, mesmo princípio de nunca acoplar tabelas sem necessidade). Quando
  `type = 'sangria'` e `amount >= p_alert_threshold`, grava em
  `cash_shift_audit_events` (`event_type = 'sangria_grande'`) dentro da mesma
  transação.
- **`close_cash_shift_secure`** (migration 051, assinatura hoje `(p_shift_id
  uuid, p_closing_counted_cash numeric)`) — mesmo cuidado de `DROP FUNCTION IF
  EXISTS` antes do `CREATE` (3 params novos no fim). Ganha
  `p_closing_cash_breakdown jsonb default null`, `p_max_tolerance numeric
  default null` (client sempre
  passa `stores.config.cash_shift_max_tolerance`, mesmo princípio de não
  acoplar tabelas dentro da RPC) e `p_approved_by_user_id uuid default null`.
  Lógica nova: calcula a diferença (já existia via
  `_cash_shift_expected_cash`); se `p_max_tolerance` não for null e
  `abs(diferença) > p_max_tolerance` e `p_approved_by_user_id` é null, devolve
  `{success:false, message:'Diferença acima do limite — precisa de aprovação
  de um supervisor.', requires_approval: true}` SEM fechar o turno. Se
  `p_approved_by_user_id` vier preenchido, valida server-side (não só confiar
  no client) que aquele usuário é `owner`/`universal` ou tem
  `permissions.supervisiona_caixa = true` antes de aceitar — grava em
  `approved_by_user_id` e fecha normalmente.
- **Nova `verify_cash_supervisor_secure(p_store_id, p_email, p_password)`** —
  `authenticate_store_user_secure` (migration 008) tem a lógica de rate-limit
  inline (não extraída em helper), então esta function replica o MESMO padrão
  inline (incrementa `login_attempts`/`login_locked_until` na mesma coluna
  compartilhada com login normal — uma tentativa errada aqui conta pro mesmo
  bloqueio de 5 tentativas/5min de login, intencional: é a mesma credencial).
  Só retorna sucesso se a senha bater E o usuário validado for `owner` ou
  tiver `permissions.supervisiona_caixa = true` — usada pelo modal de
  aprovação (supervisor digita a própria senha ali mesmo, sem precisar
  deslogar quem está fechando o caixa).
- **Nova `fetch_cash_shift_audit_secure(p_store_id, p_shift_id default null,
  p_operator_user_id default null, p_limit int default 50)`** — lista eventos
  de auditoria; `p_shift_id` filtra "eventos deste turno" (tela de
  fechamento), `p_operator_user_id` (sem `p_shift_id`) filtra "eventos deste
  operador no período" (relatório gerencial) — os dois filtros são
  independentes e opcionais, nunca exigidos juntos.

### UI — Fechar Caixa (`CaixaView`, `StoreModule.tsx`)

- Campo único "Valor conferido na gaveta" vira um grid com uma linha por
  cédula/moeda (R$200/100/50/20/10/5/2 e moedas R$1/0,50/0,25/0,10/0,05),
  input de quantidade em cada uma, total calculado e mostrado ao vivo — mesmo
  padrão de input numérico já usado no resto do app.
- "Esperado em dinheiro na gaveta" só aparece se `!stores.config.cash_shift_blind_count
  || loggedUser.role in (owner, universal) || loggedUser.permissions.supervisiona_caixa`.
  Quando oculto, aparece só DEPOIS de "Confirmar Fechamento" (na tela de
  resultado, mesmo texto de hoje) — nunca escondido pra sempre, só durante a
  contagem.
- Diferença acima do limite de aviso: mensagem inline, deixa confirmar normal.
  Acima do limite máximo: botão "Confirmar Fechamento" vira "Pedir aprovação de
  supervisor" → abre modal pedindo email+senha de um supervisor (chama
  `verify_cash_supervisor_secure`), só depois chama `close_cash_shift_secure`
  com o `approved_by_user_id` resolvido.
- Seção nova (mesmo modal, expansível) "Eventos deste turno" —
  `fetch_cash_shift_audit_secure(storeId, shiftId)` (sem filtro de operador,
  já é o turno de um operador só) lista cancelamentos/sangrias grandes com
  hora.

### UI — Ponto (`StoreLayout.handleToggleCheckin`, `StoreModule.tsx`)

- Bater ponto de ENTRADA (`!openCheckin`, hoje chama `startCheckin` direto):
  se `permissions.caixa === true` e não há turno aberto do próprio usuário
  (`fetchOpenCashShift`), abre um modal opcional "Quer abrir seu caixa
  também?" com o campo de fundo de troco — "Só bater ponto" fecha o modal sem
  abrir caixa, "Abrir os dois" chama `startCheckin` + `openCashShift` em
  sequência.
- Bater ponto de SAÍDA (`openCheckin` existe, hoje chama `endCheckin` direto):
  se há turno de caixa aberto do próprio usuário, mostra modal "Você ainda tem
  um caixa aberto" com botão "Fechar caixa agora" (abre o fluxo de fechamento)
  e botão "Sair mesmo assim" (chama `endCheckin` normalmente, turno continua
  aberto pra fechar depois — nunca bloqueado).

### UI — Relatório gerencial (`operatorBreakdown`, `StoreAdminView`)

- Tabela existente (vendas/receita por `operador_nome`) ganha 2 colunas:
  contagem de eventos de auditoria no período (link/expansível pra lista, via
  `fetch_cash_shift_audit_secure` filtrado por operador) e diferença
  acumulada de fechamento de caixa daquele operador — somada client-side a
  partir de `fetch_cash_shifts_history_secure` (já existente, já devolve
  `difference` por turno) chamada com um `limit` alto o bastante pro período
  selecionado, sem RPC nova. Se o período for muito longo e isso não escalar
  bem, adicionar um filtro de operador/período direto na RPC vira ajuste de
  implementação, não redesenho.

### Guard-rails

- Nada disso muda o cálculo de `_cash_shift_expected_cash` (dedup de
  pagamento de mesa já corrigido na migration 052) — só adiciona campos ao
  redor.
- `close_cash_shift_secure` continua nunca travando um fechamento
  indefinidamente: se a loja não configurou tolerância (`stores.config` sem
  as chaves novas), usa os defaults (aviso R$5, máximo R$20) — nunca exige
  aprovação por acidente numa loja que nunca configurou nada.
- Toda nova função `security definer` segue o padrão já estabelecido:
  `set search_path = public`, grant explícito pra `anon, authenticated`, e
  `NOTIFY pgrst, 'reload schema'` depois de aplicar (achado real 2026-08-27,
  `count_active_tables_secure` — PostgREST cacheia schema e não vê function
  nova sozinho, erro `PGRST202`).

## Fora de escopo / não resolvido aqui

- Sistema de planos contratados como limitador de features — nenhum benchmark
  de mercado direto encontrado pra isso (é padrão de SaaS genérico, não de
  PDV especificamente); resolvido à parte no mesmo dia como "só Master Admin
  edita módulos", sem conceito de plano formal ainda.
- Alertas em tempo real (email/SMS) por evento de auditoria — a pesquisa
  encontrou isso como prática comum, mas não foi pedido; a trilha fica
  disponível na tela, sem notificação ativa por enquanto.
- "Floating till"/turno compartilhado entre terminais.
- Qualquer coisa envolvendo desconto ou hardware de gaveta (sem feature/
  integração existente pra apoiar isso hoje).
