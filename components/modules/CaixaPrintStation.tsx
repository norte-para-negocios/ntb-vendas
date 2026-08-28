'use client';

// Reconciliação de impressão do Caixa (redesign 2026-08-23).
//
// O QUE É: substitui a antiga "Estação de Impressão" (`EstacaoModule.tsx`,
// rota `/estacao`, apagadas nesta sessão) — um aparelho fixo, dedicado, que
// alguém deixava ligado na cozinha. O dono rejeitou esse desenho na prática:
// *"na cozinha não vai ter um tablet, não vai ter um equipamento. O único
// equipamento vai ter no caixa"*. A impressora da cozinha é de rede (IP
// próprio), configurada como padrão no SISTEMA OPERACIONAL do aparelho do
// caixa (mesma ideia de instalar qualquer impressora) — então
// `window.print()`, disparado do navegador do caixa, já sai por ela sem
// nenhum dispositivo/rota dedicados.
//
// O QUE ESTE ARQUIVO FAZ: roda em segundo plano, dentro da sessão normal do
// caixa (montado em `StoreLayout`, sobrevive à troca de aba Mesas↔Balcão),
// pra cobrir TODOS os caminhos que não têm "aparelho próprio" pra imprimir
// no momento em que o pedido é criado — autoatendimento do cliente via QR,
// Balcão, e (desde a revisão crítica de 2026-08-23, ver abaixo) também o
// garçom.
//
// Revisão crítica 2026-08-23 ("waiter-launched orders print nowhere real,
// silently"): até aqui, o pedido lançado pelo garçom (`TablesView.
// handleAddItem`) tentava imprimir na hora, no PRÓPRIO aparelho do garçom —
// e essa reconciliação ignorava esses itens de propósito (`added_by_role
// !== 'garcom'`), assumindo que já tinham sido tratados. Confirmado direto
// com o dono: o celular do garçom NÃO tem acesso à impressora de rede da
// cozinha — só o aparelho do Caixa tem. `window.print()` "tinha sucesso" no
// aparelho do garçom mesmo sem nenhuma impressora configurada ali, e o
// pedido nunca chegava na cozinha, sem avisar ninguém. Correção, nos dois
// lados: `handleAddItem` parou de tentar imprimir (o pedido continua criado
// exatamente como antes), e o filtro `added_by_role !== 'garcom'` abaixo foi
// removido — item de garçom agora recebe o MESMO tratamento de QR/Balcão.
//
// GARANTIA CENTRAL (herdada do EstacaoModule.tsx original, ver git log
// daquele arquivo pro histórico completo de revisão): uma cozinha nunca pode
// parar de receber pedido em silêncio. Cada mecanismo abaixo (dedupe por
// localStorage com teto, reconciliação em intervalo fixo além do Realtime,
// try/catch em volta do corpo inteiro do reconcile — não só das chamadas de
// impressão —, distinção entre "fila genuinamente vazia" e "a própria
// chamada ao servidor falhou") é uma resposta direta a uma forma real de
// isso acontecer, já encontrada e corrigida no station original.
//
// CORTE DE ATIVAÇÃO (`activatedAt`, adicionado na revisão crítica de
// 2026-08-23 — "missing activation cutoff makes backlog-spew deterministic"):
// `fetch_kitchen_orders_secure` devolve TODO item não-`delivered`/`canceled`
// da loja, sem nenhum corte de tempo (migration 021) — numa loja
// `direct_print`, nada além de FECHAR A MESA avança esse status, então numa
// sessão de caixa nova (outro celular, aba anônima, localStorage limpo, o
// dono ou a conta universal abrindo o painel pra checar algo) o único freio
// contra reimprimir tudo de novo é o dedupe local (`printedIds`), que é
// vazio nessa sessão. Sem corte, a PRIMEIRA reconciliação dessa sessão nova
// reimprimiria cada item ainda aberto do turno inteiro — não é uma corrida
// rara, é determinístico. `activatedAt` (hora do mount desta sessão,
// recarregado junto com `printedIds` sempre que a loja muda) resolve isso
// sem imprimir menos: item criado ANTES da ativação desta sessão não é
// auto-impresso aqui (pode já ter sido impresso por outra sessão), mas
// continua listado em "Pedidos do Dia" (`TablesView.sentHistoryItems`,
// StoreModule.tsx) com um botão manual "Reimprimir" — nunca fica invisível,
// só para de ser reimpresso às cegas. Esse botão manual, por sua vez, só é
// oferecido no aparelho de caixa de verdade (Critical #2 da revisão de
// branch 2026-08-23, ver `isCaixaRole`/`canReprint` em StoreModule.tsx) —
// nunca a um garçom, que não teria como saber se `window.print()` "com
// sucesso" imprimiu algo real. **Correção de relógio (mesma revisão,
// Critical #2 — "activation cutoff trusts the device's clock, not the
// server's")**: `activatedAt` nascia de `new Date()`, o relógio do
// APARELHO, mas é comparado contra `created_at`, que vem do relógio do
// SERVIDOR (Postgres) — um aparelho com o relógio adiantado excluía pedidos
// legítimos do auto-print sem avisar ninguém. Ver ACTIVATION_SAFETY_MARGIN_MS
// abaixo pro fix e o porquê da escolha (margem fixa, não "maior created_at
// devolvido pelo servidor").
//
// O QUE NÃO FOI PORTADO (decisão consciente, não esquecimento): o station
// original também reconciliava PEDIDOS FECHADOS (comprovante de conta paga,
// `reconcileCaixa` de lá) — necessário porque aquele mecanismo rodava num
// aparelho SEPARADO do caixa, que precisava descobrir "uma mesa fechou" por
// fora. Aqui isso deixou de fazer sentido: quem fecha a conta É o caixa,
// nesta mesma sessão, e o comprovante já imprime na hora do clique
// (`TablesView.handleFinishPayment`/`CounterView`, Task 4) — não há mais
// nenhum "fechamento sem aparelho por perto" pra reconciliar. Portar essa
// metade seria reintroduzir exatamente a duplicata que o `printTarget`
// antigo existia pra evitar, com muito mais código.
// `activatedAt`/corte de ativação (que o station usava só nesse
// `reconcileCaixa`, pra não reimprimir até 24h de comprovantes antigos ao
// ativar um aparelho novo) também não tem equivalente aqui pelo mesmo
// motivo: não existe reconciliação de fechamento pra proteger.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff, XCircle, RotateCcw, CheckCircle2 } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { toast } from '@/components/Toast';
import { fetchKitchenOrders, subscribeToStoreOrderChanges, StoreOrdersConnectionStatus, fetchPrinterConfigs, enqueuePrintJob } from '@/lib/api';
import { printKitchenTicket, buildKitchenTicketText } from '@/lib/print';
import { PrinterConfig } from '@/types';
import { playPrintFailureAlert, vibrateAlert } from '@/lib/audioAlert';
import { resolveOrderFlow } from '@/lib/storeModules';
import { parseItemNote } from '@/lib/labels';
import { Store, OrderItem, StoreUser } from '@/types';

type Destination = 'kitchen' | 'bar';

function isBrowser() {
  return typeof window !== 'undefined';
}

const STORAGE_PREFIX = 'ntb_caixa_print';
// Mesmo teto do station original — trava de segurança pra um browser que
// fica logado dias a fio não acumular um localStorage sem limite (os
// pedidos ativos em si já são limitados a 500 por fetch_kitchen_orders_secure,
// migration 021).
const MAX_PRINTED_IDS = 1000;
// Depois de N falhas seguidas do MESMO item, a reconciliação automática para
// de tentar sozinha (evita bater print() repetidamente sem gesto novo) e
// passa a exigir toque manual em "Reimprimir" no painel de detalhes —
// também garante que o item fica visível até alguém agir.
const MAX_AUTO_RETRIES = 3;
// Número de reconciliações CONSECUTIVAS cuja própria chamada ao servidor
// falhou antes de acender o indicador de falha persistente. Um erro
// passageiro de rede não precisa virar alarme, mas falhas seguidas do
// backstop de 10s já somam tempo suficiente pra não ser ruído.
const RECONCILE_FAILURE_ALERT_THRESHOLD = 2;
// Corte de ativação (Critical #2, revisão de branch 2026-08-23 — "activation
// cutoff trusts the device's clock, not the server's"): `activatedAtRef`
// nasce de `new Date()` (relógio do APARELHO do caixa), mas é comparado
// contra `it.created_at`, que vem do Postgres (relógio do SERVIDOR). Um
// tablet barato ou celular com hora errada adiantado alguns minutos em
// relação ao banco faz TODO pedido criado nesse intervalo, no exato momento
// em que a sessão nova monta, ser silenciosamente excluído do auto-print —
// sem alarme nenhum (o indicador só acende por falha de fetch/conexão/
// impressão, e "pulei um item por corte" parece idêntico a "fila vazia").
// Corrigido subtraindo uma margem de segurança fixa do instante do
// aparelho antes de usá-lo como corte, em vez de confiar cegamente no
// relógio local. Descarta a alternativa "usar o maior created_at devolvido
// pelo servidor na primeira reconciliação como corte": ela tem um problema
// de ovo-e-galinha real aqui — a primeira reconciliação desta sessão
// PRECISA de algum corte pra decidir o que imprimir automaticamente antes
// mesmo dela existir um `created_at` de referência (sessão nova sem pedido
// nenhum na fila, por exemplo), então sempre sobra ou (a) não imprimir nada
// no primeiro fetch até ter uma referência — reabre exatamente o "backlog
// spew" que o corte existe pra evitar — ou (b) usar `Date.now()` mesmo,
// mantendo o bug original. A margem fixa evita esse impasse e o efeito
// colateral (imprimir de novo um item que talvez outra sessão já tenha
// impresso nesses minutos) é o erro aceitável: um ticket duplicado é
// recuperável (jogar fora), um pedido nunca impresso não é.
const ACTIVATION_SAFETY_MARGIN_MS = 5 * 60 * 1000;

// Ver ACTIVATION_SAFETY_MARGIN_MS acima pro porquê: `activatedAtRef` nunca
// deve ser o instante cru do aparelho (relógio local != relógio do
// servidor, que é quem gera `created_at`) — sempre alguns minutos ANTES
// dele, pra absorver adiantamento de relógio sem reabrir o "backlog spew"
// que o corte de ativação existe pra evitar.
function activationCutoffNow(): string {
  return new Date(Date.now() - ACTIVATION_SAFETY_MARGIN_MS).toISOString();
}

function printedIdsKey(storeId: string, destination: Destination) {
  return `${STORAGE_PREFIX}_impressos_${storeId}_${destination}`;
}

function loadPrintedIds(storeId: string, destination: Destination): Set<string> {
  if (!isBrowser()) return new Set();
  try {
    const raw = window.localStorage.getItem(printedIdsKey(storeId, destination));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function savePrintedIds(storeId: string, destination: Destination, ids: Set<string>) {
  if (!isBrowser()) return;
  const arr = Array.from(ids);
  const trimmed = arr.length > MAX_PRINTED_IDS ? arr.slice(arr.length - MAX_PRINTED_IDS) : arr;
  window.localStorage.setItem(printedIdsKey(storeId, destination), JSON.stringify(trimmed));
}

// Leitura read-only do dedupe persistido, pro histórico do dia (TablesView,
// "Pedidos do Dia") poder mostrar "impresso"/"pendente" num item de origem
// cliente sem duplicar a lógica de chave/localStorage acima. Best-effort de
// propósito: só reflete o que ESTE navegador já viu confirmadamente
// impresso — um item impresso por outra sessão/aparelho não aparece aqui
// (não existe estado de impressão persistido no servidor, ver cabeçalho do
// arquivo), então a UI que consome isto trata "não encontrado" como "sem
// registro nesta sessão", nunca como "não imprimiu".
export function wasKitchenTicketPrinted(storeId: string, destination: 'kitchen' | 'bar', itemId: string): boolean {
  return loadPrintedIds(storeId, destination).has(itemId);
}

// Reimpressão manual de um item específico, usada por "Pedidos do Dia"
// (TablesView, StoreModule.tsx) pra dar um jeito de recuperar, com um toque
// humano, qualquer item que a reconciliação automática não imprimiu sozinha
// — o caso mais comum sendo item criado ANTES do corte de ativação desta
// sessão (`activatedAt`, ver cabeçalho do arquivo), mas serve pra qualquer
// item marcado "sem registro" na lista, seja qual for o motivo. Faz as duas
// coisas que a reconciliação automática faz por item: imprime E, se der
// certo, marca no MESMO dedupe local (`printedIds`) que a reconciliação usa
// — assim um reimpresso manualmente não volta a ser candidato automático na
// próxima passada.
export async function printPendingKitchenTicket(params: {
  storeId: string;
  storeName: string;
  destination: 'kitchen' | 'bar';
  itemId: string;
  orderId: string;
  tableNumber: number | string;
  quantity: number;
  productName: string;
  addons?: string;
  observation?: string;
  client?: string | null;
  paperWidthMm?: 48 | 58 | 80;
}): Promise<boolean> {
  const ok = await printKitchenTicket({
    kind: params.destination === 'bar' ? 'BAR' : 'COZINHA',
    storeName: params.storeName,
    orderType: 'MESA',
    identifier: `MESA ${params.tableNumber}`,
    client: params.client,
    quantity: params.quantity,
    productName: params.productName,
    addons: params.addons,
    observation: params.observation,
    orderIdShort: params.orderId.slice(0, 8),
    paperWidthMm: params.paperWidthMm,
  });
  if (ok) {
    const ids = loadPrintedIds(params.storeId, params.destination);
    ids.add(params.itemId);
    savePrintedIds(params.storeId, params.destination, ids);
  }
  return ok;
}

function ticketDescription(item: OrderItem): string {
  const orderType = item.order?.order_type;
  const tableNumber = item.order?.tables?.number;
  const local = orderType === 'counter' ? 'Balcão' : `Mesa ${tableNumber ?? '?'}`;
  return `${item.quantity}x ${item.product?.name || 'Produto indisponível'} — ${local}`;
}

interface FailedEntry {
  key: string;
  description: string;
  attempts: number;
  retry: () => Promise<boolean>;
}

// Revisão crítica 2026-08-23 (Important #I1 — "restrict the auto-print loop
// itself to caixa === true"): ANTES, dono/universal sempre contavam aqui
// (mesmo bypass usado em canFinalizeBill, lib/storeModules.ts) — quem
// decidia se o mecanismo rodava era só `resolveOrderFlow(store) ===
// 'direct_print'`. Problema real: dono/universal abrindo o painel do Caixa
// só pra checar algo, num aparelho qualquer (sem impressora de cozinha
// nenhuma configurada nele), disparava `window.print()` sozinho, sem gesto
// nenhum pedindo isso. Corrigido: só quem tem a permissão `caixa` marcada de
// verdade dispara o LOOP de auto-impressão — dono/universal continuam vendo
// o app normalmente (inclusive "Pedidos do Dia", que não depende desta
// função) e podem imprimir manualmente lá se precisar, mas não rodam a
// reconciliação em segundo plano sozinhos só por terem aberto a tela.
//
// Achado ao vivo (mesma revisão, verificação com chrome-devtools): checar só
// `permissions?.caixa === true` NÃO bastava. `universalPermissionsFor`
// (StoreModule.tsx) monta o objeto `permissions` sintético de uma conta
// universal com `caixa: modules.caixa` — ou seja, espelha se a LOJA tem o
// módulo Caixa ligado, não se ESTE usuário é operador de caixa. Numa loja
// com `modules.caixa: true` (ex.: a Sertão), isso fazia TODA conta
// universal logar já com `permissions.caixa === true`, reabrindo
// exatamente o buraco que este fix existe pra fechar. `role` explícito
// (nunca 'owner'/'universal') é o que realmente distingue "operador de
// caixa de carne e osso, com a permissão marcada pelo Master Admin" de
// "qualquer conta universal, nesta loja específica".
// Exportada (Critical #2, revisão de branch 2026-08-23 — "Reimprimir pode
// mentir sucesso num aparelho sem impressora"): `StoreModule.tsx` (histórico
// "Pedidos do Dia") precisa do MESMO critério pra decidir se oferece o botão
// manual "Reimprimir" — não um critério parecido, o mesmo, senão as duas
// checagens divergem silenciosamente no futuro (ex.: alguém ajusta um dos
// dois lados e esquece do outro). Não reusar a instância do HOOK
// `useCaixaPrintStation` pra isso — chamá-lo de novo em `TablesView`
// duplicaria a reconciliação em segundo plano inteira (Realtime, intervalo
// de 10s, dedupe em memória), rodando duas cópias independentes do mesmo
// mecanismo na mesma sessão. `isCaixaRole` sozinha é pura/sem estado, então
// dá pra reusar só o critério sem reusar o efeito.
// Achado ao vivo (2026-08-28, corrigido em 2 passos): a exigência de
// `permissions.caixa === true` vetava dono E universal de disparar a
// reconciliação -- na loja Sertão, o teste ao vivo foi feito logado como
// "Equipe Norte Para Negócios" (conta universal), e o requisito confirmado
// pelo dono na hora foi explícito e repetido: "qualquer login, qualquer
// pedido, imprime -- não importa quem tá logado". Primeiro passo (liberar só
// `owner`) não bastou porque o teste real usa universal. Segundo passo:
// TODO login com sessão de loja válida conta agora, sem exceção nenhuma.
// A preocupação original da revisão de 2026-08-23 (dono/universal abrindo o
// painel num aparelho qualquer, sem impressora nenhuma, disparando
// `window.print()` à toa) continua real só pra impressora "Sistema padrão"
// (browser_default) -- mas o roteamento de verdade desta loja usa
// impressoras USB/rede cadastradas (`enqueuePrintJob`, ver
// `matchingNetworkPrinters` abaixo), que é seguro disparar de qualquer
// login: só grava uma linha na fila, quem imprime de fato é o agente ligado
// na impressora certa, nunca o aparelho de quem clicou. Trade-off aceito
// por pedido explícito do dono, não esquecimento.
export function isCaixaRole(_user: Pick<StoreUser, 'role' | 'permissions'>): boolean {
  return true;
}

// Impressoras de rede/USB (aba "Impressão", migration 061, 2026-08-27)
// cadastradas pra esta loja e este destino — best-effort, ADITIVO ao
// window.print() de sempre, nunca no lugar dele: um erro aqui (rede
// fora, tabela vazia) não pode derrubar o mecanismo já testado que as 6
// lojas reais dependem hoje. `!printerConfigId` filtra 'browser_default'
// (metadado, sem fila) e inativas.
function matchingNetworkPrinters(printers: PrinterConfig[], destination: Destination): PrinterConfig[] {
  return printers.filter((p) => p.is_active && (p.connection_type === 'network' || p.connection_type === 'usb') && (p.destination === destination || p.destination === 'all'));
}

async function reconcileDestination(
  storeId: string,
  destination: Destination,
  storeName: string,
  activatedAt: string,
  printedIdsRef: React.MutableRefObject<Record<Destination, Set<string>>>,
  failedRef: React.MutableRefObject<Map<string, FailedEntry>>,
  setFailedItems: (m: Map<string, FailedEntry>) => void,
  networkPrinters: PrinterConfig[],
): Promise<boolean> {
  let fetchFailed = false;
  const items = await fetchKitchenOrders(storeId, destination, () => { fetchFailed = true; });
  const printedIds = printedIdsRef.current[destination];
  // Achado da revisão de branch 2026-08-23 (disclosed, não Critical, mas
  // acknowledged de propósito — "same-browser double-tab printing"):
  // `printedIdsRef` era carregado do localStorage só UMA vez, no mount
  // (efeito de `store?.id` acima). Duas abas do MESMO navegador no MESMO
  // aparelho de caixa (uma aba duplicada por acidente) cada uma mantinha o
  // próprio Set em memória, nunca via o que a outra aba já tinha marcado —
  // e cada uma reconciliava/imprimia o MESMO pedido a cada passada, pro
  // resto do turno inteiro (não uma corrida rara de um item só: durável,
  // todo item, enquanto as duas abas ficarem abertas). Corrigido relendo o
  // localStorage aqui, a cada reconciliação (a cada 10s de backstop e a
  // cada evento Realtime — já rodava com essa frequência de qualquer
  // forma), e mesclando no Set em memória ANTES de decidir o que imprimir:
  // um id que a aba irmã já persistiu aparece aqui na próxima passada, sem
  // esperar reload/F5.
  loadPrintedIds(storeId, destination).forEach((id) => printedIds.add(id));
  const activatedAtMs = new Date(activatedAt).getTime();
  // Corte de ativação (Critical #1, ver cabeçalho do arquivo): item criado
  // ANTES do mount desta sessão não é auto-impresso aqui — pode já ter sido
  // tratado por outra sessão, e reimprimir às cegas é exatamente o "backlog
  // spew" do achado. Continua elegível pra reimpressão MANUAL via "Pedidos
  // do Dia" (`printPendingKitchenTicket`) — nunca fica invisível, só para de
  // ser reimpresso sem gesto humano nenhum. Item de garçom entra no MESMO
  // caminho que QR/Balcão agora (ver cabeçalho do arquivo, revisão crítica
  // "waiter-launched orders print nowhere real") — não há mais filtro por
  // `added_by_role`.
  const toPrint = items.filter((it) => !printedIds.has(it.id) && new Date(it.created_at).getTime() >= activatedAtMs);

  for (const item of toPrint) {
    const key = `${destination}:${item.id}`;
    const fail = failedRef.current.get(key);
    if (fail && fail.attempts >= MAX_AUTO_RETRIES) continue; // aguardando reimpressão manual
    const kind = destination === 'bar' ? 'BAR' : 'COZINHA';
    const orderType = item.order?.order_type;
    const tableNumber = item.order?.tables?.number;
    const description = ticketDescription(item);

    // Aditivo (ver matchingNetworkPrinters acima): enfileira o MESMO
    // ticket, em texto puro, pra cada impressora de rede/USB cadastrada
    // pra este destino — o agente local (print-agent/) é quem realmente
    // manda pro papel. Fire-and-forget de propósito: uma falha aqui
    // (rede fora, tabela sem linha) não pode interromper nem marcar
    // falha no caminho window.print() já testado, que segue seu próprio
    // rastreamento de erro logo abaixo.
    const printersForItem = matchingNetworkPrinters(networkPrinters, destination);
    if (printersForItem.length > 0) {
      const { client: netClient, observation: netObservation } = parseItemNote(item.notes || '');
      const content = buildKitchenTicketText({
        kind,
        storeName,
        orderType: orderType === 'counter' ? 'BALCÃO' : 'MESA',
        identifier: orderType === 'counter' ? 'BALCÃO' : `MESA ${tableNumber ?? '?'}`,
        client: netClient,
        quantity: item.quantity,
        productName: item.product?.name || 'Produto indisponível',
        addons: (item.selected_options || []).map((o) => o.name).join(', ') || undefined,
        observation: netObservation || undefined,
        orderIdShort: item.order_id.slice(0, 8),
      });
      printersForItem.forEach((printer) => {
        enqueuePrintJob({ storeId, printerConfigId: printer.id, destination, title: description, content })
          .catch((e) => console.error('enqueuePrintJob (auto) falhou:', e));
      });
    }

    const doPrint = async () => {
      // try/catch: printKitchenTicket é Promise<boolean>, não um contrato
      // blindado contra throw — sem isto, uma rejeição não tratada
      // interromperia o `for` no meio do lote (achado real do station
      // original, fix round 2 Group B2).
      try {
        const { client, observation } = parseItemNote(item.notes || '');
        return await printKitchenTicket({
          kind,
          storeName,
          orderType: orderType === 'counter' ? 'BALCÃO' : 'MESA',
          identifier: orderType === 'counter' ? 'BALCÃO' : `MESA ${tableNumber ?? '?'}`,
          client,
          quantity: item.quantity,
          productName: item.product?.name || 'Produto indisponível',
          addons: (item.selected_options || []).map((o) => o.name).join(', ') || undefined,
          observation: observation || undefined,
          orderIdShort: item.order_id.slice(0, 8),
        });
      } catch (e) {
        console.error('printKitchenTicket lançou (tratado como falha):', e);
        return false;
      }
    };
    // Achado ao vivo (2026-08-28): quando já existe impressora USB/rede
    // cadastrada pra este destino, o `window.print()` abaixo (pensado pra
    // loja SEM impressora de rede nenhuma) não tem mais nenhuma impressora
    // real esperando por ele -- ele falhava (ou imprimia em qualquer coisa
    // marcada como padrão do Windows/Mac daquele aparelho, sem relação com
    // cozinha/bar de verdade), e essa falha deixava o botão "Reimprimir"
    // manual aparecendo pra um pedido que JÁ saiu certinho pela fila.
    // `printersForItem.length > 0` é o mesmo sinal já usado acima pra
    // decidir se enfileira -- reusado aqui pra decidir se `window.print()`
    // sequer deveria rodar: a fila sendo real substitui o caminho antigo
    // pra este destino, não some ADITIVA a ele.
    // eslint-disable-next-line no-await-in-loop -- impressão sequencial de propósito: dois print() quase simultâneos empilhariam diálogos nativos no mesmo instante.
    const ok = printersForItem.length > 0 ? true : await doPrint();

    if (ok) {
      printedIds.add(item.id);
      savePrintedIds(storeId, destination, printedIds);
      if (failedRef.current.has(key)) {
        failedRef.current.delete(key);
        setFailedItems(new Map(failedRef.current));
      }
    } else {
      const attempts = (fail?.attempts || 0) + 1;
      failedRef.current.set(key, { key, description, attempts, retry: doPrint });
      setFailedItems(new Map(failedRef.current));
    }
  }
  return fetchFailed;
}

export interface CaixaPrintStationState {
  active: boolean;
  connectionStatus: StoreOrdersConnectionStatus;
  online: boolean;
  lastReconcileAt: string | null;
  lastReconcileFailed: boolean;
  persistentReconcileFailure: boolean;
  failedItems: FailedEntry[];
  retryItem: (key: string) => Promise<void>;
}

// Hook que efetivamente roda a reconciliação. Montado UMA vez em
// StoreLayout (sobrevive à troca de aba Mesas↔Balcão, que é exatamente o
// requisito: "regardless of which tab"). `active` decide se o efeito
// principal sequer liga — nas 6 lojas reais sem `order_flow: 'direct_print'`
// isto nunca roda, sem footprint nenhum (nem intervalo, nem assinatura
// Realtime, nem leitura de localStorage).
export function useCaixaPrintStation(store: Store | null, loggedUser: StoreUser | null): CaixaPrintStationState {
  const active = !!store && !!loggedUser && resolveOrderFlow(store) === 'direct_print' && isCaixaRole(loggedUser);

  const [connectionStatus, setConnectionStatus] = useState<StoreOrdersConnectionStatus>('connecting');
  const [online, setOnline] = useState(true);
  const [lastReconcileAt, setLastReconcileAt] = useState<string | null>(null);
  const [lastReconcileFailed, setLastReconcileFailed] = useState(false);
  const [persistentReconcileFailure, setPersistentReconcileFailure] = useState(false);
  const [failedItemsState, setFailedItemsState] = useState<Map<string, FailedEntry>>(new Map());

  const printedIdsRef = useRef<Record<Destination, Set<string>>>({ kitchen: new Set(), bar: new Set() });
  const failedRef = useRef<Map<string, FailedEntry>>(new Map());
  const reconcileLockRef = useRef(false);
  const reconcileFailStreakRef = useRef(0);
  const storeRef = useRef<Store | null>(null);
  // Corte de ativação desta sessão (Critical #1, corrigido pro Critical #2 —
  // ver ACTIVATION_SAFETY_MARGIN_MS acima) — hora do mount MENOS a margem de
  // segurança, recarregada junto com o dedupe sempre que a loja muda (mesmo
  // efeito abaixo). Um `Date.now()` de fallback nunca deveria ser lido de
  // verdade (o efeito abaixo roda antes do primeiro `reconcile()` sempre que
  // `store` já existe no mount), mas existe pra nunca deixar a comparação de
  // corte comparar contra `null`/`NaN` num cenário inesperado.
  const activatedAtRef = useRef<string>(activationCutoffNow());

  // Recarrega o dedupe (localStorage) sempre que a loja muda — cobre tanto
  // "loja resolveu depois do login" quanto "conta universal trocou de loja".
  // Também redefine `activatedAtRef`: trocar de loja (conta universal) é,
  // pra efeito do corte de ativação, uma sessão nova nesta loja — mesmo
  // motivo de `printedIds` recarregar do zero aqui.
  useEffect(() => {
    storeRef.current = store;
    if (!store) return;
    printedIdsRef.current = {
      kitchen: loadPrintedIds(store.id, 'kitchen'),
      bar: loadPrintedIds(store.id, 'bar'),
    };
    activatedAtRef.current = activationCutoffNow();
    failedRef.current = new Map();
    setFailedItemsState(new Map());
  }, [store?.id]);

  const reconcile = useCallback(async () => {
    const s = storeRef.current;
    if (!s || reconcileLockRef.current) return;
    reconcileLockRef.current = true;
    let fetchFailed = false;
    try {
      // Best-effort, fora do try/catch de impressão: uma falha aqui só
      // significa "nenhuma impressora de rede/USB entra nesta passada",
      // o window.print() de sempre continua rodando normalmente.
      const networkPrinters = await fetchPrinterConfigs(s.id).catch(() => [] as PrinterConfig[]);
      for (const destination of ['kitchen', 'bar'] as const) {
        // eslint-disable-next-line no-await-in-loop -- sequencial de propósito, mesmo motivo do print sequencial dentro de reconcileDestination.
        const failed = await reconcileDestination(s.id, destination, s.name, activatedAtRef.current, printedIdsRef, failedRef, setFailedItemsState, networkPrinters);
        if (failed) fetchFailed = true;
      }
    } catch (e) {
      // try/catch em volta do CORPO INTEIRO do reconcile, não só das
      // chamadas de impressão — achado real do station original (fix round
      // 3, Group A1): sem isto, um throw que escapasse reconcileDestination
      // (ex.: dado malformado não previsto) abortava esta função inteira
      // ANTES de sinalizar falha, deixando o indicador travado no último
      // estado bom pra sempre, com cada tick seguinte lançando de novo em
      // silêncio.
      console.error('CaixaPrintStation.reconcile lançou (tratado como falha):', e);
      fetchFailed = true;
    } finally {
      setLastReconcileAt(new Date().toISOString());
      setLastReconcileFailed(fetchFailed);
      reconcileFailStreakRef.current = fetchFailed ? reconcileFailStreakRef.current + 1 : 0;
      setPersistentReconcileFailure(reconcileFailStreakRef.current >= RECONCILE_FAILURE_ALERT_THRESHOLD);
      reconcileLockRef.current = false;
    }
  }, []);

  // Assinatura Realtime + backstop de intervalo + foco/online — mesmos 4
  // gatilhos do station original (ativar, ping Realtime, intervalo fixo,
  // volta de foco/rede), só que aqui "ativar" é "a sessão do caixa qualifica
  // pra isto agora" em vez de um botão explícito: `window.print()` não é
  // gateado por gesto novo no Chromium (mesma pesquisa já documentada no
  // station original), e o caixa já está ativamente usando o painel — pedir
  // um clique extra só pra "ligar a impressão de fundo" seria fricção sem
  // ganho real de garantia.
  useEffect(() => {
    if (!active || !store) return;
    reconcile();
    const unsubscribe = subscribeToStoreOrderChanges(store.id, () => reconcile(), setConnectionStatus, 'print');
    const intervalId = window.setInterval(() => reconcile(), 10000);
    const onVisible = () => { if (document.visibilityState === 'visible') reconcile(); };
    document.addEventListener('visibilitychange', onVisible);
    const onOnline = () => reconcile();
    window.addEventListener('online', onOnline);
    return () => {
      unsubscribe();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [active, store, reconcile]);

  useEffect(() => {
    if (!isBrowser()) return;
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Alerta sonoro de falha (achado real, 2026-08-25): um badge vermelho
  // discreto no header não é visto a tempo numa cozinha barulhenta — toca só
  // na TRANSIÇÃO pra um estado de alarme (nunca a cada render/tick com o
  // alarme já ligado, senão viraria ruído constante). `wasAlarmedRef` guarda
  // o último estado conhecido; começa `false` (nunca alarma no primeiro
  // mount só porque `active` acabou de virar true).
  const wasAlarmedRef = useRef(false);
  useEffect(() => {
    if (!active) return;
    const isAlarmed = failedItemsState.size > 0 || persistentReconcileFailure || !online;
    if (isAlarmed && !wasAlarmedRef.current) {
      playPrintFailureAlert();
      vibrateAlert([200, 100, 200, 100, 200]);
    }
    wasAlarmedRef.current = isAlarmed;
  }, [active, failedItemsState, persistentReconcileFailure, online]);

  const retryItem = useCallback(async (key: string) => {
    const entry = failedRef.current.get(key);
    if (!entry) return;
    let ok = false;
    try {
      ok = await entry.retry();
    } catch (e) {
      console.error('Reimpressão manual (Caixa) lançou (tratado como falha):', e);
      ok = false;
    }
    if (ok) {
      const [destination, itemId] = key.split(':') as [Destination, string];
      printedIdsRef.current[destination]?.add(itemId);
      if (storeRef.current) savePrintedIds(storeRef.current.id, destination, printedIdsRef.current[destination]);
      failedRef.current.delete(key);
      setFailedItemsState(new Map(failedRef.current));
      toast.success('Reimpresso com sucesso.');
    } else {
      failedRef.current.set(key, { ...entry, attempts: 0 }); // zera contagem: reimpressão manual sempre pode tentar de novo depois
      setFailedItemsState(new Map(failedRef.current));
      toast.error('A reimpressão também falhou. Verifique a impressora.');
    }
  }, []);

  return {
    active,
    connectionStatus,
    online,
    lastReconcileAt,
    lastReconcileFailed,
    persistentReconcileFailure,
    failedItems: Array.from(failedItemsState.values()),
    retryItem,
  };
}

// --- Indicador pequeno pro header/chrome ------------------------------
//
// Diferente do banner de tela cheia do station original (que fazia sentido
// lá — a tela inteira daquele aparelho NÃO tinha outro propósito): o caixa
// está fazendo outro trabalho ao mesmo tempo (mesas, comandas, pagamento),
// então isto é só um badge pequeno e persistente, que abre um painel de
// detalhes (Modal, não tela cheia) só quando clicado.
// M2 (revisão de código 2026-08-23): `connectionStatus` começa em
// 'connecting' a cada mount (StoreLayout monta este hook uma vez por
// sessão/F5) — sem grace period, `isAlarmed` incluía esse estado transitório
// dentro de `!isConnected`, deixando o badge vermelho por um instante em
// TODO carregamento, mesmo quando a conexão real vai fechar normal em
// seguida (falso alarme cosmético). `CONNECTING_GRACE_MS` só perdoa
// especificamente "ainda conectando" — falha real de reconciliação
// (`hasFailures`/`persistentReconcileFailure`) ou ficar `disconnected`/
// offline de verdade continuam acendendo o alarme na hora, sem carência
// nenhuma.
const CONNECTING_GRACE_MS = 4000;

// --- Banner de modo offline ---------------------------------------------
//
// Achado real (2026-08-25): a detecção de offline (`status.online`) já
// existia, mas só aparecia como um badge pequeno no header — fácil de não
// notar no meio do corre. Diferente do `CaixaPrintStationIndicator`
// (montado duas vezes, mobile+desktop, ver comentário lá), este banner só
// pode ter UM mount point: `useEffect`/render duplicado tudo bem pro
// indicador pequeno, mas uma faixa fixa de tela cheia duplicada empilharia
// duas faixas idênticas. Montado uma vez só, em `StoreLayout`.
//
// Só acende pra offline de verdade (`!status.online`, evento nativo do
// navegador) — não pra "reconciliando por backstop" (`connectionStatus`
// != 'connected' mas ainda online), que já tem o próprio indicador
// discreto e se resolve sozinho na maioria das vezes sem precisar de
// alarme de tela cheia.
export const CaixaPrintStationOfflineBanner: React.FC<{ status: CaixaPrintStationState }> = ({ status }) => {
  if (!status.active || status.online) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-[60] bg-[var(--err)] text-white text-center text-xs sm:text-sm font-bold px-4 py-2 flex items-center justify-center gap-2">
      <WifiOff size={14} className="shrink-0" />
      Sem conexão com a internet — anote os pedidos no papel até reconectar. A impressão automática está pausada.
    </div>
  );
};

export const CaixaPrintStationIndicator: React.FC<{ status: CaixaPrintStationState; className?: string; storeName?: string }> = ({ status, className, storeName }) => {
  const [showDetails, setShowDetails] = useState(false);
  const [withinConnectingGrace, setWithinConnectingGrace] = useState(true);
  const [testingPrint, setTestingPrint] = useState(false);

  // "Testar Impressão" (achado real, 2026-08-25): sem isso, ninguém descobre
  // se o Chrome deste aparelho está em modo silencioso (kiosk-printing) até
  // um pedido de verdade travar num diálogo nativo do SO esperando alguém
  // clicar — o que quebra a promessa central deste mecanismo inteiro
  // ("imprime sozinha, em segundo plano"). Ticket de teste real, mesmo
  // `printKitchenTicket` do loop automático — não um mock — pra realmente
  // provar o caminho fim a fim.
  const handleTestPrint = async () => {
    setTestingPrint(true);
    try {
      const ok = await printKitchenTicket({
        kind: 'COZINHA',
        storeName: storeName || 'Loja',
        orderType: 'MESA',
        identifier: 'TESTE DE IMPRESSÃO',
        quantity: 1,
        productName: 'Ticket de teste — pode descartar',
        observation: 'Se isso imprimiu sem pedir nenhum clique, a impressão silenciosa está configurada corretamente.',
        orderIdShort: 'TESTE',
      });
      if (ok) toast.success('Ticket de teste enviado. Confira se saiu na impressora sem pedir nenhum clique.');
      else toast.error('Falha ao enviar o ticket de teste.');
    } finally {
      setTestingPrint(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setWithinConnectingGrace(false), CONNECTING_GRACE_MS);
    return () => window.clearTimeout(timeoutId);
  }, []);

  if (!status.active) return null;

  const isConnected = status.connectionStatus === 'connected' && status.online;
  const isStillConnecting = status.connectionStatus === 'connecting' && status.online;
  const hasFailures = status.failedItems.length > 0;
  // Falha na própria consulta ao servidor (distinto de "0 pedidos
  // pendentes") também acende o indicador, mesmo sem nenhum item na lista
  // de falhas — é exatamente o caso que o `onError` de fetchKitchenOrders
  // existe pra não deixar passar em silêncio.
  const isAlarmed = hasFailures || status.persistentReconcileFailure || (!isConnected && !(isStillConnecting && withinConnectingGrace));

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDetails(true)}
        title="Impressão automática (Caixa) — clique pra ver detalhes"
        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold u-motion u-press-sm border ${
          isAlarmed
            ? 'bg-[var(--err)]/10 border-[var(--err)]/30 text-[var(--err)]'
            : 'bg-[var(--ok)]/10 border-[var(--ok)]/30 text-[var(--ok)]'
        } ${className || ''}`}
      >
        {isConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
        <span className="hidden sm:inline">Impressão</span>
        {hasFailures && (
          <span className="flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[var(--err)] text-white text-[10px] font-bold num">
            {status.failedItems.length}
          </span>
        )}
      </button>

      <Modal isOpen={showDetails} onClose={() => setShowDetails(false)} title="Impressão automática (Caixa)" variant="sheet">
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            Imprime sozinha, em segundo plano, o pedido do próprio cliente (QR), do Balcão e do garçom — nenhum aparelho além deste tem a impressora da cozinha configurada.
          </p>

          <Button size="sm" variant="secondary" className="w-full" onClick={handleTestPrint} isLoading={testingPrint}>
            Testar Impressão
          </Button>
          <p className="text-[11px] text-[var(--text-muted)] -mt-1">
            Se pedir pra você clicar em "Imprimir" ou escolher impressora, este aparelho não está configurado pra imprimir sozinho — avise o suporte antes de abrir a loja.
          </p>

          <div className="flex items-center gap-2 text-sm">
            {isConnected ? <Wifi size={16} className="text-[var(--ok)]" /> : <WifiOff size={16} className="text-[var(--err)]" />}
            <span className={isConnected ? 'text-[var(--text)]' : 'text-[var(--err)] font-semibold'}>
              {isConnected ? 'Conectado' : 'Sem conexão em tempo real — reconciliando por backstop'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            {status.lastReconcileFailed ? <XCircle size={16} className="text-[var(--err)]" /> : <CheckCircle2 size={16} className="text-[var(--ok)]" />}
            <span className={status.lastReconcileFailed ? 'text-[var(--err)] font-semibold' : 'text-[var(--text-muted)]'}>
              {status.lastReconcileAt
                ? `Última verificação: ${new Date(status.lastReconcileAt).toLocaleTimeString('pt-BR')}${status.lastReconcileFailed ? ' — falhou ao consultar o servidor' : ''}`
                : 'Aguardando primeira verificação...'}
            </span>
          </div>

          {status.persistentReconcileFailure && (
            <div className="p-3 rounded-lg bg-[var(--err)]/10 border border-[var(--err)]/30 text-sm text-[var(--err)] font-semibold">
              Falha ao buscar pedidos no servidor por tempo demais — avise o suporte. A impressão automática pode estar cega.
            </div>
          )}

          {hasFailures ? (
            <div className="space-y-2">
              <p className="text-xs font-bold text-[var(--err)] uppercase tracking-wide">
                {status.failedItems.length} impressão(ões) falharam
              </p>
              {status.failedItems.map((entry) => (
                <div key={entry.key} className="flex items-center justify-between gap-3 bg-[var(--surface-2)] rounded-lg p-3 border border-[var(--border)]">
                  <span className="text-sm text-[var(--text)] truncate">{entry.description}</span>
                  <Button size="sm" variant="danger" onClick={() => status.retryItem(entry.key)}>
                    <RotateCcw size={14} className="mr-1" /> Reimprimir
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">Nenhuma falha registrada nesta sessão.</p>
          )}
        </div>
      </Modal>
    </>
  );
};
