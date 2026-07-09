# Fase 1 — Fecha RLS de mesas + bloqueia fechar mesa com pedido em preparo

Data: 2026-07-09
Status: aprovado, aguardando plano de implementação

## Contexto

Varredura ampla no `ntb-vendas` (código real, não brainstorm) achou 13-18 pontos de
melhoria em bugs latentes, segurança, UX, performance e fricção de setup. O usuário
decidiu atacar em 3 fases por criticidade. Esta spec cobre só a **Fase 1**:
segurança (RLS aberta em `tables`/`table_sessions`) + o bug mais grave de pedido
(mesa fechando com item ainda em preparo na cozinha).

Fases 2 e 3 (demais bugs+UX, depois performance+fricção de setup) ficam para specs
próprias, fora de escopo deste documento.

## Achados que esta fase resolve

1. **RLS aberta em `tables`/`table_sessions`** (`supabase/migrations/004_table_sessions.sql:20`,
   nunca revogada — confirmado, só duas migrations tocam essas tabelas: `001` e `004`).
   Catalogada no `AGENTS.md:439-446` como "menor severidade, sem PII". Na prática, com a
   anon key pública (embutida no bundle JS), dá pra listar/ler o `pin` em texto puro e
   outros campos (`waiter_requested`, `current_host_name`) de qualquer mesa de qualquer
   loja, e sequestrar sessão de anfitrião sem escanear o QR code físico. Mesma classe de
   achado que já foi corrigida em `orders`/`order_items`/`products` nas migrations
   `021_fecha_rls_orders_products.sql` / `022_revoga_anon_orders_products.sql`.

2. **Mesa fechando com item ainda em preparo.** `close_table_orders_secure`
   (`supabase/migrations/021_fecha_rls_orders_products.sql:138-156`) marca **todos** os
   `order_items` da mesa como `delivered`, inclusive os que estão `pending`/`preparing`
   de verdade. O painel do lojista (`StoreModule.tsx`, `handleOpenPayment`/
   `handleFinishPayment`) não checa isso antes de finalizar — só o `BillSplitter` do
   lado do cliente tem uma checagem equivalente (`hasPendingItems`).

3. **Bug novo descoberto durante esta investigação**: `moveTable` (`lib/api.ts:839-875`)
   faz `UPDATE` direto em `orders.table_id`. A migration `022` revogou todo
   `INSERT`/`UPDATE`/`DELETE` anônimo em `orders` sem criar RPC substituta para mover
   pedidos entre mesas. Ou seja, **mover mesa está quebrado silenciosamente desde
   2026-07-07** (RLS bloqueia o update, sem erro visível ao lojista). Corrigido junto
   nesta fase porque a correção de `tables` já mexe exatamente nessa função.

Fora do escopo desta fase (não resolvido aqui, por design):
- Autenticação real por `store_user` (JWT/Supabase Auth) — resolveria a raiz de "quem
  pode chamar qual RPC", mas é reforma grande, já classificada como fora de escopo no
  `AGENTS.md`. Sem ela, qualquer RPC que recebe `p_store_id` confia nele — mesmo nível
  de segurança que `orders`/`products` já têm hoje (ex.: `fetch_sales_history_secure`,
  `clear_sales_history_secure` não checam se quem chama é daquela loja). Esta fase só
  traz `tables`/`table_sessions` para esse mesmo nível, não além dele.

## Arquitetura

### Bloco A — Migration `029_fecha_rls_tables.sql`

RPCs `security definer` novas (uma por ação de negócio, mesmo padrão da migration 021):

| RPC | Substitui | Observação |
|---|---|---|
| `get_tables_secure(p_store_id)` | `select('*').eq('store_id', ...)` em `api.ts:526` | **Nunca** retorna a coluna `pin` |
| `get_table_pin_secure(p_table_id)` | leitura de `pin` embutida no select geral | chamada só quando o lojista clicar "Ver PIN" |
| `request_waiter_secure(p_table_id)` | `api.ts:664` | seta `waiter_requested = true` |
| `cancel_waiter_request_secure(p_table_id)` | `api.ts:669` | seta `waiter_requested = false` |
| `toggle_service_fee_secure(p_table_id, p_removed)` | `api.ts:674` | |
| `open_table_manually_secure(p_table_id, p_store_id, p_host_name)` | `api.ts:776-778` | update `tables` + insert `table_sessions` |
| `request_table_bill_secure(p_table_id)` | `api.ts:781-782` | |
| `toggle_table_block_secure(p_table_id)` | `api.ts:834-836` | |
| `move_table_secure(p_source_table_id, p_target_table_id)` | `api.ts:839-875` (`moveTable`) | atomiza tudo: valida mesa destino disponível, move `orders.table_id`, atualiza mesa origem (gera PIN novo) e destino, transfere `table_sessions` aberta — tudo dentro da própria função, em vez de 5 chamadas separadas do client |
| `finalize_table_secure(p_table_id)` | `api.ts:806-823` (parte final de `closeTableSession`) | gera PIN novo, reseta `status`/`current_host_name`/`waiter_requested`/`service_fee_removed` |
| `sync_store_tables_secure(p_store_id, p_target_count)` | `api.ts:1042,1094-1139` | cria/remove linhas de `tables` ao criar/editar/deletar loja no admin |

Depois de todas as RPCs criadas e testadas: `drop policy allow_all_anon` em `tables` e
`table_sessions`, recriando `select using (false)` nas duas (mesmo padrão exato de
`orders`/`order_items` na migration `022`). Nenhuma dessas tabelas precisa de SELECT
público — diferente de `products`, que o cardápio lê direto.

### Bloco B — Client (`lib/api.ts`, `components/modules/ClientModule.tsx`)

Trocar as ~13 chamadas diretas listadas acima por `supabase.rpc(...)` equivalente.
**Sem mudar a assinatura pública** das funções já exportadas (`moveTable`,
`closeTableSession`, `openTableManually` etc.) — os componentes que já as chamam
(`StoreModule.tsx`, `ClientModule.tsx`) não precisam mudar, só a implementação interna.

`ClientModule.tsx:1311` (leitura do estado da mesa pelo cliente) já exclui o campo
`pin` explicitamente no `select` — vira `get_tables_secure` (ou uma RPC de leitura
individual equivalente), mantendo esse cuidado.

### Bloco C — Trava de finalização com pendências

Em `handleOpenPayment`/`handleFinishPayment` (`StoreModule.tsx:1306,1336`): os itens da
mesa já vêm com `status` via `getTableSummary(tableId).allItems`
(`StoreModule.tsx:1236-1258`, que lê de `activeOrders`, alimentado por
`fetchActiveOrdersForTables`). Antes de abrir o modal de pagamento (ou, no mínimo,
antes de `handleFinishPayment` confirmar), checar se algum item tem
`status` em `pending`/`preparing`. Se houver, bloquear com toast: "Ainda tem N item(ns)
em preparo — marque como entregue ou cancele antes de fechar a mesa." Mesmo texto/tom
dos demais toasts de erro já usados no arquivo.

## Testes (QA ao vivo)

Sempre na loja "Vieras e Vinhos" (ou Bistrô Demo pra fluxos que não envolvem
integração fiscal/Omie), via Chrome DevTools MCP ou Playwright:

1. Abrir mesa, mandar item pra cozinha, tentar finalizar → deve bloquear com a
   mensagem nova.
2. Marcar item como entregue, finalizar → deve fechar normalmente, gerar PIN novo.
3. Abrir duas mesas, mover pedidos de uma pra outra com `move_table_secure` → pedidos
   devem aparecer na mesa destino de verdade (hoje isso falha silenciosamente).
4. Chamar garçom / cancelar chamado / pedir conta / bloquear mesa — confirmar que cada
   ação ainda funciona via RPC.
5. "Ver PIN" no painel do lojista → deve continuar funcionando, agora via
   `get_table_pin_secure`.
6. Repetir o teste que confirma o fechamento de RLS: com a mesma anon key, tentar
   `SELECT`/`UPDATE` direto em `tables`/`table_sessions` via REST → deve devolver vazio
   / falhar, igual já foi validado para `orders`/`order_items` em 07/07.

## Riscos

- `sync_store_tables_secure` mexe em criação/edição/exclusão de loja no admin —
  superfície menos testada em produção que os fluxos de balcão/mesa/cozinha. Testar
  manualmente criar loja nova + editar contagem de mesas antes de considerar fechado.
- `move_table_secure` consolida 5 operações em uma transação — testar explicitamente o
  caminho de erro (mesa destino ocupada) para garantir que a RPC aborta sem deixar
  estado parcial (ex.: pedidos movidos mas mesa origem não resetada).
