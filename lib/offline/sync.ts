import { getPendingActions, markDone, markFailed, getFailedActions, resetActionAttempts, discardAction } from './queue';
import { checkRealConnectivity } from './network';
import type { QueuedAction } from './types';
import { supabase } from '../supabaseClient';
import { resolverUrlApi, triggerOrdemProducao, triggerEmissaoFiscal } from '../api';

const MAX_ATTEMPTS = 3;

type SyncStatus = { syncing: boolean; pending: number; failed: number };
let currentStatus: SyncStatus = { syncing: false, pending: 0, failed: 0 };
const listeners = new Set<(s: SyncStatus) => void>();

export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

export function onSyncStatusChange(cb: (s: SyncStatus) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(status: SyncStatus) {
  currentStatus = status;
  listeners.forEach((cb) => cb(status));
}

// Mapa local_id -> id real do banco, válido só durante uma sessão de
// sincronização (ver Global Constraint do spec: IDs locais temporários
// de create_order precisam ser resolvidos antes de qualquer ação
// seguinte que dependa deles, ex. update_order_item_status de um item
// desse pedido). Lança (não engole) qualquer erro — quem chama
// (runSync) decide markDone/markFailed.
async function processAction(action: QueuedAction, idMap: Map<string, string>): Promise<void> {
  switch (action.type) {
    case 'create_order': {
      // payload já está no formato de RPC (Task 4 monta rpcPayload e
      // enfileira ele mais localOrderId) — chama a RPC direto, sem
      // reconstruir CartItem[].
      const { localOrderId, ...rpcPayload } = action.payload as any;
      const { data, error } = await supabase.rpc('create_order_secure', rpcPayload);
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Erro ao criar pedido.');
      if (localOrderId && data.order_id) idMap.set(localOrderId, data.order_id);
      break;
    }
    case 'update_order_item_status': {
      const payload = action.payload as any;
      const realItemId = idMap.get(payload.p_item_id) ?? payload.p_item_id;
      const { error } = await supabase.rpc('update_order_item_status_secure', { p_item_id: realItemId, p_status: payload.p_status });
      if (error) throw error;
      break;
    }
    case 'close_table_session': {
      const payload = action.payload as any;
      // C2: `paymentData.cash_shift_id` pode carregar o `local_<uuid>` falso
      // do turno aberto offline (ver case 'open_cash_shift' acima) — resolve
      // via idMap numa CÓPIA de `paymentData`, nunca mutando o payload
      // original da ação (só importa se essa mesma ação for reprocessada,
      // mas é o mesmo cuidado já seguido no resto deste arquivo).
      let paymentData = payload.paymentData;
      if (paymentData?.cash_shift_id) {
        const realShiftId = idMap.get(paymentData.cash_shift_id) ?? paymentData.cash_shift_id;
        paymentData = { ...paymentData, cash_shift_id: realShiftId };
      }
      const { error: closeErr } = await supabase.rpc('close_table_orders_secure', {
        p_table_id: payload.tableId, p_payment_method: payload.paymentMethod, p_payment_details: paymentData,
      });
      if (closeErr) throw closeErr;
      const { error: finalizeErr } = await supabase.rpc('finalize_table_secure', { p_table_id: payload.tableId });
      if (finalizeErr) throw finalizeErr;
      triggerOrdemProducao({ tableId: payload.tableId });
      triggerEmissaoFiscal({ tableId: payload.tableId, destinatario: payload.destinatario });
      break;
    }
    case 'close_counter_order': {
      const payload = action.payload as any;
      // Entregar fecha a venda; pagar registra o dinheiro. No fluxo "balcão
      // paga primeiro" as duas viraram ações INDEPENDENTES da fila offline
      // (registrar_pagamento_balcao + close_counter_order) — e a entrega não
      // depende de nada do pagamento pra rodar. Se o pagamento falhar em
      // definitivo (MAX_ATTEMPTS, e aí é pulado pra sempre pelo runSync), a
      // entrega sincronizaria normalmente e marcaria o pedido 'delivered'
      // com payment_method/payment_details NULOS: venda entregue, no
      // histórico, fora do turno de caixa e fora de qualquer conferência.
      // Achado de revisão independente, 2026-09-13.
      //
      // A fila é relida AQUI (e não do snapshot de runSync) de propósito: as
      // ações já concluídas nesta mesma rodada foram apagadas por markDone,
      // então um pagamento que acabou de sincronizar (é o caminho normal —
      // ele foi enfileirado ANTES, e a fila drena por createdAt) não aparece
      // mais e não adia a entrega à toa.
      const fila = await getPendingActions();
      const pagamentoDoPedido = fila.find(
        (a) =>
          a.type === 'registrar_pagamento_balcao' &&
          (a.payload as any)?.orderId === payload.orderId,
      );
      if (pagamentoDoPedido) {
        // Lançar aqui faz runSync chamar markFailed nesta ação — ou seja, a
        // entrega também conta tentativa e, depois de MAX_ATTEMPTS, para de
        // tentar e passa a aparecer no badge de falhas com o lastError
        // abaixo. É de propósito: adiar em silêncio pra sempre esconderia do
        // operador que existe uma venda entregue no balcão que o sistema se
        // recusa a fechar. A distinção de mensagem importa porque é o texto
        // que ele vê — "ainda não sincronizou" é espera normal, "falhou" é
        // ação humana (registrar o pagamento de novo, com o pedido reaberto).
        if (pagamentoDoPedido.attempts >= MAX_ATTEMPTS) {
          throw new Error(
            'O pagamento deste pedido falhou em definitivo na sincronização — a entrega não pode fechar a venda sem pagamento. Registre o pagamento de novo neste pedido.',
          );
        }
        throw new Error(
          'Pagamento deste pedido ainda não sincronizou — entrega adiada até o pagamento entrar.',
        );
      }
      // C2: mesmo raciocínio do case 'close_table_session' acima.
      let paymentData = payload.paymentData;
      if (paymentData?.cash_shift_id) {
        const realShiftId = idMap.get(paymentData.cash_shift_id) ?? paymentData.cash_shift_id;
        paymentData = { ...paymentData, cash_shift_id: realShiftId };
      }
      if (paymentData) {
        const paymentMethod = paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE';
        const res = await fetch(resolverUrlApi('/api/orders/pagamento-balcao'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: payload.orderId, paymentMethod, paymentDetails: paymentData }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message || 'Falha ao registrar o pagamento do pedido de balcão.');
        }
      }
      // close_counter_order_secure retorna `void` (não `jsonb`, ver
      // supabase/migrations/021_fecha_rls_orders_products.sql) — não tem
      // `data.success` pra checar, então C1 não se aplica a este case
      // (confirmado lendo a migration antes de mexer, ver task-12-report.md).
      const { error } = await supabase.rpc('close_counter_order_secure', { p_order_id: payload.orderId });
      if (error) throw error;
      triggerOrdemProducao({ orderId: payload.orderId });
      triggerEmissaoFiscal({ orderId: payload.orderId, destinatario: payload.destinatario });
      break;
    }
    // "Balcão paga primeiro" (pedido do André, 2026-09-11): igual ao case
    // acima na parte do pagamento, mas de propósito SEM
    // close_counter_order_secure e SEM triggerOrdemProducao — neste fluxo o
    // pedido continua aberto depois de pago, e só fecha (com a baixa de
    // estoque) quando alguém entrega. Fechar aqui entregaria sozinho um
    // pedido que talvez nem tenha ido pra cozinha ainda.
    case 'registrar_pagamento_balcao': {
      const payload = action.payload as any;
      let paymentData = payload.paymentData;
      if (paymentData?.cash_shift_id) {
        const realShiftId = idMap.get(paymentData.cash_shift_id) ?? paymentData.cash_shift_id;
        paymentData = { ...paymentData, cash_shift_id: realShiftId };
      }
      const paymentMethod = paymentData.methods.length === 1 ? paymentData.methods[0].method : 'MULTIPLE';
      const res = await fetch(resolverUrlApi('/api/orders/pagamento-balcao'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: payload.orderId, paymentMethod, paymentDetails: paymentData }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || 'Falha ao registrar o pagamento do pedido de balcão.');
      }
      triggerEmissaoFiscal({ orderId: payload.orderId, destinatario: payload.destinatario });
      break;
    }
    case 'open_cash_shift': {
      // C1/C2 da revisão final (ver task-12-report.md): `open_cash_shift_secure`
      // recusa com `{success:false, message}` de NEGÓCIO (ex. "você já tem um
      // turno de caixa aberto") sem lançar exception — sem checar `data`, essa
      // recusa era tratada como sucesso (markDone, ação some da fila). Também
      // captura `data` pra resolver o id local (C2): `localShiftId` (adicionado
      // ao payload por `openCashShift` em lib/api.ts) -> `data.id` (id real do
      // turno recém-criado), pra qualquer ação seguinte na mesma sessão de sync
      // que referencie esse turno (register_cash_movement/close_cash_shift/
      // close_table_session/close_counter_order) resolver o id real via idMap
      // em vez de carregar o `local_<uuid>` falso pra sempre.
      const { localShiftId, ...rpcPayload } = action.payload as any;
      const { data, error } = await supabase.rpc('open_cash_shift_secure', rpcPayload);
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Erro ao sincronizar.');
      if (localShiftId && data.id) idMap.set(localShiftId, data.id);
      break;
    }
    case 'close_cash_shift': {
      // Verificado contra closeCashShift (lib/api.ts): o payload enfileirado
      // lá é `{ p_shift_id, p_closing_counted_cash, p_closing_cash_breakdown,
      // p_max_tolerance, p_approved_by_user_id }` — já no formato exato dos
      // parâmetros da RPC `close_cash_shift_secure`, mesmo padrão dos
      // outros casos acima (chamada direta à RPC, nunca via lib/api.ts).
      // C1: agora também valida `data?.success` (mesmo motivo do case
      // 'open_cash_shift' acima — recusa de negócio, ex. diferença de caixa
      // acima da tolerância, não pode virar markDone silencioso). C2: resolve
      // `p_shift_id` via idMap ANTES de montar o payload da RPC, mesmo padrão
      // já usado pro case 'update_order_item_status' com `p_item_id`.
      const payload = action.payload as any;
      const realShiftId = idMap.get(payload.p_shift_id) ?? payload.p_shift_id;
      const { data, error } = await supabase.rpc('close_cash_shift_secure', { ...payload, p_shift_id: realShiftId });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Erro ao sincronizar.');
      break;
    }
    case 'register_cash_movement': {
      // C1 (checa data?.success) + C2 (resolve p_shift_id via idMap), mesmo
      // raciocínio do case 'close_cash_shift' acima.
      const payload = action.payload as any;
      const realShiftId = idMap.get(payload.p_shift_id) ?? payload.p_shift_id;
      const { data, error } = await supabase.rpc('register_cash_movement_secure', { ...payload, p_shift_id: realShiftId });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Erro ao sincronizar.');
      break;
    }
    case 'open_table_manually': {
      // open_table_manually_secure retorna `void` (não `jsonb`, ver
      // supabase/migrations/030_fecha_rls_tables.sql) — mesmo caso de
      // close_counter_order_secure acima: sem `data.success` pra checar,
      // C1 não se aplica aqui (confirmado lendo a migration antes de mexer).
      const payload = action.payload as any;
      const { error } = await supabase.rpc('open_table_manually_secure', payload);
      if (error) throw error;
      break;
    }
  }
}

let syncing = false;

// C3 da revisão final (2026-09-08, ver task-12-report.md): a trava `syncing`
// era checada ANTES do `await checkRealConnectivity()` (até 4s) e só setada
// `true` DEPOIS desse await — `startOfflineSync()` registra 3 gatilhos
// (evento 'online', poll de 30s, chamada imediata), e dois caindo dentro
// dessa janela de 4s (comum bem no momento da reconexão, que é exatamente
// quando o evento 'online' e o poll tendem a coincidir) processavam a fila
// inteira EM PARALELO — risco real de pedido/pagamento/sangria duplicados.
// Corrigido setando `syncing = true` ANTES do await de conectividade, com um
// único `try/finally` cobrindo a função inteira a partir daí — todo caminho
// de saída (inclusive o early return de "não está online de verdade") agora
// passa por `syncing = false` ao final, então a trava nunca fica presa em
// `true` se `checkRealConnectivity()` ou qualquer passo seguinte lançar.
export async function runSync(): Promise<void> {
  if (syncing) return; // nunca duas sincronizações em paralelo
  syncing = true;
  try {
    const online = await checkRealConnectivity();
    if (!online) {
      const pending = (await getPendingActions()).length;
      notify({ syncing: false, pending, failed: 0 });
      return;
    }

    const idMap = new Map<string, string>();
    const actions = await getPendingActions(); // já vem ordenado por createdAt
    for (const action of actions) {
      // Sequencial de propósito (Global Constraint: nunca em paralelo —
      // evita condição de corrida entre ações da mesma mesa).
      //
      // I1: `MAX_ATTEMPTS` antes não limitava nada de verdade — nada filtrava
      // a fila por tentativas, e esta função reprocessava TODA linha a cada
      // 30s pra sempre, mesmo uma que já tinha estourado o limite. Uma ação
      // que já atingiu `MAX_ATTEMPTS` é pulada (não tenta de novo), mas
      // continua contando como falha pro badge (ver cálculo de `failedCount`
      // abaixo, que agora reflete o total de ações no limite, não só as que
      // falharam NESTA rodada).
      if (action.attempts >= MAX_ATTEMPTS) continue;
      try {
        await processAction(action, idMap);
        await markDone(action.id);
      } catch (e) {
        await markFailed(action.id, (e as Error).message || 'Erro desconhecido');
        // Continua pra próxima ação da fila mesmo com esta falhando —
        // Global Constraint: uma falha nunca trava as ações seguintes.
      }
    }
    const remaining = await getPendingActions();
    const failedCount = remaining.filter((a) => a.attempts >= MAX_ATTEMPTS).length;
    notify({ syncing: false, pending: remaining.length, failed: failedCount });
  } finally {
    syncing = false;
  }
}

// ---------------------------------------------------------------------------
// Fila de falhas visível pro operador (fix round 1 da Task 7, revisão
// independente, 2026-09-14)
//
// Até aqui, `lastError` era gravado por markFailed e NUNCA lido por nenhum
// componente: o badge do StoreLayout mostrava só "🔴 N falha(s) — verificar",
// sem lista, sem clique. Ou seja, a mensagem que a entrega bloqueada grava
// ("o pagamento falhou em definitivo, registre de novo") existia só dentro da
// IndexedDB — o operador via um número e não sabia nem qual pedido. As
// funções abaixo são o que a lista de falhas do StoreLayout consome; o padrão
// (lista + retry manual por item) é o mesmo que CaixaPrintStation já usa pras
// impressões falhas.
// ---------------------------------------------------------------------------

// `#` + 4 primeiros dígitos de um id — é o mesmo recorte que o card do
// Balcão já mostra ("#dfc1"), então o operador reconhece na tela. Ids de
// mesa/turno/item não aparecem em lugar nenhum da UI, mas continuam sendo a
// única identificação que o payload carrega: melhor um id curto do que
// "Fechamento de mesa" sem dizer qual.
function refCurta(valor: unknown): string {
  return typeof valor === 'string' && valor.length > 0 ? `#${valor.slice(0, 4)}` : '';
}

function emReais(valor: unknown): string {
  return typeof valor === 'number' && Number.isFinite(valor)
    ? `R$ ${valor.toFixed(2).replace('.', ',')}`
    : '';
}

// Junta os pedaços que existirem, sem deixar " — " solto quando o payload
// não tem nada identificável (fix round 2: nesse caso é melhor dizer que
// não dá pra identificar do que inventar rótulo).
function comDetalhe(base: string, partes: (string | false | null | undefined)[]): string {
  const detalhe = partes.filter(Boolean).join(', ');
  return detalhe ? `${base} — ${detalhe}` : `${base} — sem identificação no registro`;
}

// Rótulo curto e humano de uma ação da fila — o operador não conhece
// 'close_counter_order', ele conhece "entrega do pedido #dfc1". Fix round 2
// da revisão: todos os 9 tipos identificam o alvo com o que o payload já
// carrega (mesa, item, turno, valor, nome do cliente), não só os dois de
// balcão — sem isso a lista dizia QUE falhou, mas não ONDE agir.
export function descreverAcaoFila(action: QueuedAction): string {
  const p = (action.payload ?? {}) as any;
  switch (action.type) {
    case 'create_order': {
      const onde = p.p_table_id ? `mesa ${refCurta(p.p_table_id)}` : 'balcão';
      const itens = Array.isArray(p.p_items) ? `${p.p_items.length} item(ns)` : '';
      return comDetalhe('Envio de pedido novo', [onde, p.p_customer_name || false, itens]);
    }
    case 'update_order_item_status':
      return comDetalhe('Mudança de status de item', [
        refCurta(p.p_item_id) && `item ${refCurta(p.p_item_id)}`,
        typeof p.p_status === 'string' ? `para "${p.p_status}"` : '',
      ]);
    case 'close_table_session':
      return comDetalhe('Fechamento de conta de mesa', [
        refCurta(p.tableId) && `mesa ${refCurta(p.tableId)}`,
        emReais(p.paymentData?.total),
      ]);
    case 'close_counter_order':
      return comDetalhe('Entrega/fechamento do pedido de balcão', [
        refCurta(p.orderId) && `pedido ${refCurta(p.orderId)}`,
        emReais(p.paymentData?.total),
      ]);
    case 'registrar_pagamento_balcao':
      return comDetalhe('Pagamento do pedido de balcão', [
        refCurta(p.orderId) && `pedido ${refCurta(p.orderId)}`,
        emReais(p.paymentData?.total),
      ]);
    case 'open_cash_shift':
      return comDetalhe('Abertura de caixa', [
        emReais(p.p_opening_float) && `fundo de troco ${emReais(p.p_opening_float)}`,
      ]);
    case 'close_cash_shift':
      return comDetalhe('Fechamento de caixa', [
        refCurta(p.p_shift_id) && `turno ${refCurta(p.p_shift_id)}`,
        emReais(p.p_closing_counted_cash) && `contado ${emReais(p.p_closing_counted_cash)}`,
      ]);
    case 'register_cash_movement':
      return comDetalhe(p.p_type === 'suprimento' ? 'Suprimento de caixa' : 'Sangria de caixa', [
        emReais(p.p_amount),
        refCurta(p.p_shift_id) && `turno ${refCurta(p.p_shift_id)}`,
        p.p_reason || false,
      ]);
    case 'open_table_manually':
      return comDetalhe('Abertura de mesa', [
        refCurta(p.p_table_id) && `mesa ${refCurta(p.p_table_id)}`,
        p.p_host_name || false,
      ]);
    default:
      return 'Ação pendente';
  }
}

// O que exatamente deixa de acontecer ao descartar — por TIPO (fix round 2
// da revisão). Antes o aviso era um texto fixo falando de pagamento/caixa
// pra qualquer ação: quem descartava uma abertura de mesa lia algo que não
// tinha nada a ver, e — o caso grave — quem descartava um `create_order`
// não era avisado de que estava apagando um PEDIDO INTEIRO, itens e tudo,
// achando que só limpava um alerta.
export function explicarDescarteAcao(action: QueuedAction): string {
  switch (action.type) {
    case 'create_order':
      return 'Este pedido nunca chegou ao servidor: descartar APAGA o pedido inteiro, com todos os itens dele. A cozinha/bar nunca vai recebê-lo e ele não vai existir em venda nenhuma. Se o pedido é real, lance de novo antes de descartar.';
    case 'update_order_item_status':
      return 'O item vai continuar com o status antigo no servidor (quem olha o KDS não vai ver essa mudança). Refaça pela tela depois de descartar, se ainda valer.';
    case 'close_table_session':
      return 'A conta desta mesa NÃO vai ser fechada nem o pagamento registrado: a mesa continua ocupada e o dinheiro não entra no turno. Só descarte se já fechou essa mesa por outro caminho.';
    case 'close_counter_order':
      return 'O pedido de balcão NÃO vai ser fechado (e, se esta ação carregava o pagamento, ele também não é registrado). O pedido continua aberto na tela do Balcão.';
    case 'registrar_pagamento_balcao':
      return 'O pagamento NÃO vai ser registrado: o pedido volta a aparecer como não pago e esse dinheiro não entra no fechamento do caixa. Só descarte se for receber de novo pela tela.';
    case 'open_cash_shift':
      return 'O turno de caixa não vai existir no servidor. Qualquer venda/movimentação que dependia dele fica sem turno — abra o caixa de novo pela tela antes de continuar operando.';
    case 'close_cash_shift':
      return 'O turno continua ABERTO no servidor, com a contagem que você fez perdida. Feche o caixa de novo pela tela.';
    case 'register_cash_movement':
      return 'Esta sangria/suprimento não vai ser lançada: o esperado em dinheiro do turno vai ficar diferente do que tem na gaveta. Lance de novo pela tela se o dinheiro saiu/entrou de verdade.';
    case 'open_table_manually':
      return 'A mesa não vai ser aberta no servidor — ela continua livre pra quem olhar de outro aparelho. Abra de novo pela tela se ainda tem gente sentada.';
    default:
      return 'Esta ação nunca vai chegar ao servidor — o efeito dela não vai acontecer.';
  }
}

export async function listarAcoesFalhas(): Promise<QueuedAction[]> {
  return getFailedActions(MAX_ATTEMPTS);
}

// Recalcula e publica o status depois de mexer na fila fora do runSync —
// sem isto o badge continuaria com o número velho até a próxima drenagem
// (30s), e "descartei a falha mas o alarme continua" é exatamente o
// comportamento que esta correção existe pra matar.
async function republicarStatus(): Promise<void> {
  const restantes = await getPendingActions();
  notify({
    syncing: false,
    pending: restantes.length,
    failed: restantes.filter((a) => a.attempts >= MAX_ATTEMPTS).length,
  });
}

// Zera as tentativas e tenta sincronizar na hora. Serve pro caso comum: a
// causa da falha era temporária (servidor fora, payload de um pedido que já
// existia) e o operador quer tentar de novo sem esperar nada.
export async function reenviarAcaoFalha(id: string): Promise<void> {
  await resetActionAttempts(id);
  await republicarStatus();
  await runSync();
}

// Descarta de vez. Quem chama TEM que avisar antes que o efeito no servidor
// nunca vai acontecer (o dinheiro não vai ser registrado, o pedido não vai
// fechar) — ver a confirmação na lista de falhas do StoreLayout.
export async function descartarAcaoFalha(id: string): Promise<void> {
  await discardAction(id);
  await republicarStatus();
}

let started = false;

// Chamado uma vez (StoreLayout, Step 3 abaixo). Escuta o evento 'online'
// do navegador E faz polling leve — 'online' sozinho não cobre o caso de
// "conectado mas sem internet de verdade" (ver checkRealConnectivity).
export function startOfflineSync(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => { runSync(); });
  setInterval(() => { runSync(); }, 30000);
  runSync(); // roda uma vez já no início, caso já existam ações pendentes de uma sessão anterior
}
