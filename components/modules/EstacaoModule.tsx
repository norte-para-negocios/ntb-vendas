'use client';

// Estação de Impressão (Task 3, plano 2026-08-22-perfis-de-loja-e-caixa).
//
// O QUE É: uma página que um aparelho barato e sempre ligado (ex.: um
// tablet velho) deixa aberta na cozinha (ou no caixa). Assina os pedidos
// novos de UMA loja via Realtime e imprime cada item automaticamente, sem
// clique — é o substituto físico do KDS pra lojas em `order_flow:
// 'direct_print'` (ver lib/storeModules.ts), e fecha os 3 caminhos que hoje
// não imprimem em nenhum lugar nessas lojas: garçom (já resolvido na Task
// 2, mas SÓ quando `print_target: 'device'`), autoatendimento do cliente
// via QR (`allow_client_open`) e Balcão — nenhum dos dois últimos foi
// tocado pela Task 2, então sem esta página eles nunca imprimiam nada.
//
// POR QUE UMA PÁGINA NOVA (não dentro de StoreModule.tsx): este aparelho
// não faz login de lojista — fica esquecido, ligado, sem ninguém
// interagindo por horas. Não precisa (nem deve) herdar sessão de
// `store_users`, sidebar, abas — é uma tela sozinha, de propósito único.
//
// GARANTIA CENTRAL (repetida em todo comentário relevante abaixo porque é
// o que este arquivo inteiro existe pra proteger): uma cozinha nunca pode
// parar de receber pedido em silêncio. Cada mecanismo abaixo (dedup por
// localStorage, reconciliação em intervalo fixo além do Realtime, alerta de
// desconexão, log de falha com reimpressão manual) é uma resposta direta a
// uma das formas de isso acontecer.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Printer, Wifi, WifiOff, Settings, RotateCcw, CheckCircle2, XCircle, ChefHat, Wine, Wallet, Clock } from 'lucide-react';
import { Button, Input, Card, Badge } from '@/components/ui';
import { toast } from '@/components/Toast';
import { confirm } from '@/components/ConfirmDialog';
import { fetchStoreBySlug, fetchKitchenOrders, fetchSalesHistory, subscribeToStoreOrderChanges, StoreOrdersConnectionStatus } from '@/lib/api';
import { printKitchenTicket, printBillReceipt, BillServiceFeeInfo } from '@/lib/print';
import { getOrderItemDisplayName } from '@/lib/labels';
import { calculateChangeForMethods, SERVICE_FEE_RATE } from '@/lib/calc';
import { resolvePrintTarget } from '@/lib/storeModules';
import { Store, OrderItem, Order } from '@/types';

// --- Configuração persistida no aparelho (localStorage) ---------------

type StationDestination = 'cozinha' | 'bar' | 'caixa';

interface StationConfig {
  slug: string;
  destination: StationDestination;
}

const STORAGE_PREFIX = 'ntb_estacao';
const CONFIG_KEY = `${STORAGE_PREFIX}_config`;
// Teto de ids/eventos guardados por estação — pedidos ativos já são
// limitados a 500 pelo próprio fetch_kitchen_orders_secure (migration 021),
// então isto é só uma trava de segurança pra um aparelho que fica ligado
// meses a fio não acumular um localStorage sem limite.
const MAX_PRINTED_IDS = 1000;
const MAX_EVENTS = 30;
// Depois de N falhas seguidas do MESMO item, a reconciliação automática
// para de tentar de novo sozinha (evita bater o print() repetidamente sem
// gesto novo — risco real de limitação de diálogo do navegador, ver
// comentário em handleActivate abaixo) e passa a exigir toque manual em
// "Reimprimir", que também garante o pedido não fica esquecido: aparece
// destacado na tela até alguém agir.
const MAX_AUTO_RETRIES = 3;
// Fix round 2 (Group B1): número de reconciliações CONSECUTIVAS cuja
// própria chamada ao servidor (fetchKitchenOrders/fetchSalesHistory)
// falhou antes de tratar isso como falha PERSISTENTE (banner vermelho de
// mesma proeminência que o de conexão). Um único erro passageiro de rede
// não precisa virar alarme — mas 2 falhas seguidas do backstop de 10s (ver
// intervalId abaixo) já são ~20s sem conseguir nem SABER se há pedido
// pendente, tempo suficiente pra não ser ruído.
const RECONCILE_FAILURE_ALERT_THRESHOLD = 2;

function isBrowser() {
  return typeof window !== 'undefined';
}

function loadConfig(): StationConfig | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.slug || !['cozinha', 'bar', 'caixa'].includes(parsed?.destination)) return null;
    return parsed as StationConfig;
  } catch {
    return null;
  }
}

function saveConfig(config: StationConfig) {
  if (!isBrowser()) return;
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function clearConfig() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(CONFIG_KEY);
}

function printedIdsKey(storeId: string, destination: StationDestination) {
  return `${STORAGE_PREFIX}_impressos_${storeId}_${destination}`;
}

// Passo 2 do brief: "um pedido já impresso não pode reimprimir num reload
// nem numa reconexão". A fonte da verdade é este Set, persistido por
// loja+destino (não por aparelho inteiro — dois destinos configurados em
// abas diferentes do MESMO aparelho não podem compartilhar o mesmo
// histórico, senão um "already printed" da cozinha esconderia o item do
// bar). Carregado uma vez ao montar a página com esta config.
function loadPrintedIds(storeId: string, destination: StationDestination): Set<string> {
  if (!isBrowser()) return new Set();
  try {
    const raw = window.localStorage.getItem(printedIdsKey(storeId, destination));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function savePrintedIds(storeId: string, destination: StationDestination, ids: Set<string>) {
  if (!isBrowser()) return;
  // Set preserva ordem de inserção — cortar do início mantém os mais
  // recentes quando estoura o teto.
  const arr = Array.from(ids);
  const trimmed = arr.length > MAX_PRINTED_IDS ? arr.slice(arr.length - MAX_PRINTED_IDS) : arr;
  window.localStorage.setItem(printedIdsKey(storeId, destination), JSON.stringify(trimmed));
}

interface PrintEvent {
  itemId: string;
  time: string;
  description: string;
  success: boolean;
}

function eventsKey(storeId: string, destination: StationDestination) {
  return `${STORAGE_PREFIX}_eventos_${storeId}_${destination}`;
}

// Passo 3 do brief pede "o que imprimiu por último" — isso precisa
// sobreviver a um reload (é exatamente o cenário em que alguém chega na
// cozinha, dá F5 pra conferir, e precisa ver o que já saiu sem esperar um
// pedido novo).
function loadEvents(storeId: string, destination: StationDestination): PrintEvent[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(eventsKey(storeId, destination));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveEvents(storeId: string, destination: StationDestination, events: PrintEvent[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(eventsKey(storeId, destination), JSON.stringify(events.slice(0, MAX_EVENTS)));
}

const DESTINATION_LABEL: Record<StationDestination, string> = {
  cozinha: 'Cozinha',
  bar: 'Bar',
  caixa: 'Caixa',
};

const DESTINATION_ICON: Record<StationDestination, typeof ChefHat> = {
  cozinha: ChefHat,
  bar: Wine,
  caixa: Wallet,
};

// Destino de estação (rótulo pt-BR, escolhido pelo operador) -> destino de
// PRODUTO usado por fetch_kitchen_orders_secure ('kitchen'|'bar', mesmo
// enum de products.destination). 'caixa' não tem produto correspondente —
// nenhum item de pedido é "destinado ao caixa" hoje, então uma estação
// configurada como caixa não tem, ainda, nenhuma fonte de impressão
// automática (isso é o gancho pra Task 4: "Ao receber a conta, imprime o
// comprovante" — quando essa tarefa existir, ela dispara um print aqui do
// mesmo jeito; por ora a tela só fica pronta e conectada, sem nada pra
// imprimir). Documentado explicitamente na tela também, não só aqui.
function productDestinationFor(destination: StationDestination): 'kitchen' | 'bar' | null {
  if (destination === 'cozinha') return 'kitchen';
  if (destination === 'bar') return 'bar';
  return null;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function ticketDescription(item: OrderItem): string {
  const orderType = item.order?.order_type;
  const tableNumber = item.order?.tables?.number;
  const local = orderType === 'counter' ? 'Balcão' : `Mesa ${tableNumber ?? '?'}`;
  return `${item.quantity}x ${getOrderItemDisplayName(item)} — ${local}`;
}

// Task 4 (2026-08-22, módulo Caixa): generaliza o rastreio de falha/retry
// pra caber tanto ticket de cozinha/bar (por item) quanto comprovante de
// caixa (por fechamento de mesa, ver reconcileCaixa abaixo) — antes disto
// `failedRef` guardava o `OrderItem` inteiro e chamava printKitchenTicket
// direto no retry, o que só fazia sentido pro caso de cozinha/bar. `retry`
// é a própria chamada de impressão já montada (closure), então
// retryItem/o botão "Reimprimir" não precisam saber qual dos dois casos é.
interface FailedEntry {
  description: string;
  attempts: number;
  retry: () => Promise<boolean>;
}

export const EstacaoModule: React.FC = () => {
  const [config, setConfig] = useState<StationConfig | null | undefined>(undefined); // undefined = ainda não leu localStorage
  const [store, setStore] = useState<Store | null>(null);
  const [loadingStore, setLoadingStore] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Formulário de configuração (Tela A)
  const [slugInput, setSlugInput] = useState('');
  const [destinationInput, setDestinationInput] = useState<StationDestination>('cozinha');

  // Gesto exigido a CADA abertura da página (Passo 1 do brief) — nunca
  // persistido: um reload é uma página nova, o navegador não guarda
  // "permissão de imprimir sozinho" de uma sessão pra outra, então pedir de
  // novo aqui não é excesso de cautela, é a garantia real.
  const [activated, setActivated] = useState(false);
  const [activatedAt, setActivatedAt] = useState<string | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<StoreOrdersConnectionStatus>('connecting');
  const [online, setOnline] = useState(true);
  const [lastReconcileAt, setLastReconcileAt] = useState<string | null>(null);
  // Fix round 2 (Group B1): saúde da reconciliação em si (a chamada
  // fetch_kitchen_orders_secure/fetch_sales_history_secure), separada do
  // status do canal Realtime acima — os dois são subsistemas diferentes do
  // Supabase, e um pode estar saudável enquanto o outro falha (websocket
  // conectado, RPC persistentemente derrubando). `lastReconcileFailed`
  // reflete só a ÚLTIMA tentativa (distingue "0 pedidos" de "a chamada
  // falhou" na linha de status); `persistentReconcileFailure` só vira
  // `true` depois de RECONCILE_FAILURE_ALERT_THRESHOLD falhas seguidas —
  // é o gatilho do banner vermelho de mesma proeminência do de conexão.
  const [lastReconcileFailed, setLastReconcileFailed] = useState(false);
  const [persistentReconcileFailure, setPersistentReconcileFailure] = useState(false);
  const reconcileFailStreakRef = useRef(0);

  const [events, setEvents] = useState<PrintEvent[]>([]);
  const [failedItems, setFailedItems] = useState<Map<string, FailedEntry>>(new Map());

  // Espelhos em ref: reconcile() é chamada por timers/callbacks que não
  // podem depender de re-render pra enxergar o estado mais recente (closure
  // stale clássica). O estado React acima existe só pra desenhar a tela; a
  // fonte de verdade operacional destes três é sempre a ref.
  const printedIdsRef = useRef<Set<string>>(new Set());
  const failedRef = useRef<Map<string, FailedEntry>>(new Map());
  const reconcileLockRef = useRef(false);
  const storeRef = useRef<Store | null>(null);
  const destinationRef = useRef<StationDestination>('cozinha');
  // Fix round 2 (Group C2): espelho de `activatedAt` em ref pelo mesmo
  // motivo dos de cima — `reconcileCaixa` roda em callback/timer, precisa
  // do valor atual sem depender de re-render. Ver handleActivate/
  // reconcileCaixa abaixo pro uso.
  const activatedAtRef = useRef<string | null>(null);

  // --- Carrega config salva ao montar ---------------------------------
  useEffect(() => {
    setConfig(loadConfig());
  }, []);

  // --- Resolve a loja pela slug sempre que a config muda ---------------
  useEffect(() => {
    if (!config) {
      setStore(null);
      storeRef.current = null;
      return;
    }
    let cancelled = false;
    let retryTimeout: number | undefined;
    setLoadingStore(true);
    const attempt = () => {
      fetchStoreBySlug(config.slug).then(({ store: s, error }) => {
        if (cancelled) return;
        setLoadingStore(false);
        if (!s) {
          if (error === 'not_found') {
            // Loja de fato não existe pra essa slug — não adianta insistir
            // sozinho, exige corrigir a configuração. Aqui sim limpamos, pra
            // não deixar o aparelho preso configurado com um identificador
            // errado sem chance de digitar de novo.
            setSetupError('Loja não encontrada para esse identificador.');
            setStore(null);
            storeRef.current = null;
            clearConfig();
            setConfig(null);
            return;
          }
          // Erro de rede/timeout: um aparelho sempre ligado pode passar por
          // isso num boot com wifi ainda subindo — NÃO apaga a config salva
          // (perderia a slug/destino configurados por causa de uma falha
          // transitória), só tenta de novo sozinho em alguns segundos.
          setSetupError('Erro de conexão ao buscar a loja. Tentando de novo automaticamente...');
          retryTimeout = window.setTimeout(attempt, 5000);
          return;
        }
        setSetupError(null);
        setStore(s);
        storeRef.current = s;
        destinationRef.current = config.destination;
        printedIdsRef.current = loadPrintedIds(s.id, config.destination);
        failedRef.current = new Map();
        setFailedItems(new Map());
        setEvents(loadEvents(s.id, config.destination));
        setActivated(false);
        setActivatedAt(null);
        activatedAtRef.current = null;
      });
    };
    attempt();
    return () => {
      cancelled = true;
      if (retryTimeout) window.clearTimeout(retryTimeout);
    };
  }, [config]);

  // --- online/offline do navegador (sinal adicional ao status do canal) -
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

  const pushEvent = useCallback((storeId: string, destination: StationDestination, ev: PrintEvent) => {
    setEvents((prev) => {
      const next = [ev, ...prev].slice(0, MAX_EVENTS);
      saveEvents(storeId, destination, next);
      return next;
    });
  }, []);

  // --- Reconciliação: busca o estado real do servidor e imprime o que
  // ainda não foi impresso. É o mecanismo que realmente garante "nenhum
  // pedido perdido" (Passo 2/3 do brief) — a assinatura Realtime abaixo é
  // só um jeito de disparar isto mais rápido, nunca a única fonte. Chamada
  // em 4 gatilhos independentes: ao ativar, a cada ping Realtime, num
  // intervalo fixo (backstop caso o ping se perca), e quando a aba volta a
  // ficar visível/online (aparelho que hibernou ou perdeu rede).
  // Fix round 2 (Group B1): devolve `true` quando a própria chamada ao
  // servidor falhou (RPC com erro) — distinto de "chamada OK, 0 itens
  // pendentes". `reconcile()` usa isso pra alimentar o banner de saúde da
  // reconciliação, sem misturar com o resultado por-item de impressão
  // (que continua em `failedItems`/banner de impressão já existente).
  const reconcileKitchen = useCallback(async (s: Store, destination: StationDestination, productDestination: 'kitchen' | 'bar'): Promise<boolean> => {
    let fetchFailed = false;
    const items = await fetchKitchenOrders(s.id, productDestination, () => { fetchFailed = true; });
    // Mais antigo primeiro — mesma ordem que fetch_kitchen_orders_secure
    // já devolve (order by oi.created_at), preservada aqui de propósito:
    // se vários pedidos novos chegaram durante uma queda, eles saem na
    // cozinha na ordem em que foram feitos.
    const toPrint = items.filter((it) => !printedIdsRef.current.has(it.id));
    for (const item of toPrint) {
      const fail = failedRef.current.get(item.id);
      if (fail && fail.attempts >= MAX_AUTO_RETRIES) continue; // aguardando reimpressão manual, ver banner
      const kind = productDestination === 'bar' ? 'BAR' : 'COZINHA';
      const orderType = item.order?.order_type;
      const tableNumber = item.order?.tables?.number;
      const description = ticketDescription(item);
      const doPrint = async () => {
        // Fix round 2 (Group B2): a lógica de falha abaixo (marcar
        // `failedRef`, deixar o item visível pro operador reimprimir)
        // assume que `doPrint()` sempre RESOLVE, nunca REJEITA — mas
        // nada em printKitchenTicket é garantido nesse sentido (é
        // Promise<boolean>, não um contrato blindado contra throw). Se
        // isso um dia deixar de valer, uma rejeição não tratada aqui
        // interromperia o `for` inteiro no meio do lote, sem marcar o
        // item corrente (nem os seguintes) como falha — desligando em
        // silêncio o próprio mecanismo que existe pra tornar falha de
        // impressão visível. try/catch trata rejeição exatamente como
        // `ok=false`.
        try {
          return await printKitchenTicket({
            kind,
            storeName: s.name,
            orderType: orderType === 'counter' ? 'BALCÃO' : 'MESA',
            identifier: orderType === 'counter' ? 'BALCÃO' : `MESA ${tableNumber ?? '?'}`,
            quantity: item.quantity,
            productName: item.product?.name || 'Produto indisponível',
            addons: (item.selected_options || []).map((o) => o.name).join(', ') || undefined,
            observation: item.notes || undefined,
            orderIdShort: item.order_id.slice(0, 8),
          });
        } catch (e) {
          console.error('printKitchenTicket lançou (tratado como falha):', e);
          return false;
        }
      };
      // eslint-disable-next-line no-await-in-loop -- impressão precisa ser sequencial: dois print() quase simultâneos (dois pedidos chegando juntos) empilhariam diálogos nativos no mesmo instante.
      const ok = await doPrint();

      if (ok) {
        printedIdsRef.current.add(item.id);
        savePrintedIds(s.id, destination, printedIdsRef.current);
        if (failedRef.current.has(item.id)) {
          failedRef.current.delete(item.id);
          setFailedItems(new Map(failedRef.current));
        }
        pushEvent(s.id, destination, { itemId: item.id, time: new Date().toISOString(), description, success: true });
      } else {
        const attempts = (fail?.attempts || 0) + 1;
        failedRef.current.set(item.id, { description, attempts, retry: doPrint });
        setFailedItems(new Map(failedRef.current));
        pushEvent(s.id, destination, { itemId: item.id, time: new Date().toISOString(), description, success: false });
      }
    }
    return fetchFailed;
  }, [pushEvent]);

  // Módulo Caixa (Task 4, 2026-08-22) — o "gancho" que o EstacaoModule já
  // deixou documentado desde a Task 3 ("quando essa tarefa existir, ela
  // dispara um print aqui do mesmo jeito"). Diferente de cozinha/bar (uma
  // fonte por ITEM via fetch_kitchen_orders_secure), aqui a fonte é por
  // MESA FECHADA — não existe RPC nem coluna nova pra isso: reaproveita
  // fetch_sales_history_secure (já devolve orders com payment_details,
  // order_items e tables embutidos) e agrupa client-side.
  //
  // Por que dá pra saber "a mesa fechou" sem nenhuma migration: o ping
  // Realtime que já dispara `reconcile()` (order_change_pings, migration
  // 029) tem um trigger em QUALQUER insert/update/delete de `orders` — e
  // close_table_orders_secure faz um UPDATE em orders (status/
  // payment_method/payment_details) ao fechar a mesa. O ping já chega
  // sozinho, sem precisar de nada novo no banco.
  //
  // Agrupamento por "um comprovante por fechamento, não por order row": uma
  // mesa pode ter vários `orders` abertos (um por vez que o garçom mandou
  // pro servidor) e close_table_orders_secure fecha TODOS de uma vez numa
  // única transação — o Postgres usa o MESMO valor de `now()` pra todas as
  // linhas atualizadas dentro de uma transação, então pedidos do mesmo
  // fechamento compartilham `updated_at` exato. Não existe (e não é
  // permitido criar, por causa da restrição de "nenhuma migration") um id
  // de "evento de fechamento" — `table_id + updated_at` é o substituto sem
  // schema novo.
  const CAIXA_LOOKBACK_HOURS = 24;
  // Fix round 2 (Group B1): mesmo contrato de retorno de reconcileKitchen
  // acima — `true` quando a própria RPC falhou, distinto de "OK, nada pra
  // imprimir".
  const reconcileCaixa = useCallback(async (s: Store, destination: StationDestination): Promise<boolean> => {
    // Fix round 2 (Group C3): antes esta função tentava imprimir toda mesa
    // fechada incondicionalmente — a única coisa que suprimia o comprovante
    // no APARELHO DO CAIXA era `printTarget === 'device'` em
    // StoreModule.tsx (handleFinishPayment), cujo propósito documentado
    // (lib/storeModules.ts, resolvePrintTarget) sempre foi decidir ticket
    // de cozinha/bar no fluxo direct_print. Uma loja deixada no padrão
    // ('device', a maioria) que também tivesse um aparelho de estação
    // configurado como 'caixa' imprimia a conta DUAS vezes: uma no caixa
    // (device), outra aqui. Ruling: comprovante segue o MESMO
    // `print_target` que já rege ticket — um alvo só por loja, os dois
    // tipos de documento. `resolvePrintTarget(s) !== 'station'` = esta
    // loja usa impressão no aparelho do caixa; a estação de caixa fica
    // ociosa (sem sequer buscar histórico) até o Master Admin apontar
    // `print_target: 'station'` pra essa loja.
    if (resolvePrintTarget(s) !== 'station') return false;
    const sinceIso = new Date(Date.now() - CAIXA_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
    let fetchFailed = false;
    const orders = await fetchSalesHistory(s.id, sinceIso, undefined, () => { fetchFailed = true; });
    // Fix round 2 (Group C2): sem isto, um aparelho recém-ativado (ou com
    // storage limpo/perfil de navegador diferente) tem `printedIdsRef`
    // vazio e imprimiria de uma vez até 24h de comprovantes antigos — a
    // janela de lookback existe pra cobrir reconexão depois de queda, não
    // pra reimprimir o passado inteiro na primeira ativação. Cozinha/bar
    // não têm esse risco (fetch_kitchen_orders_secure só devolve item
    // ainda ABERTO, nunca histórico — ver docstring de reconcileKitchen),
    // então o corte é só aqui.
    //
    // Escolha (das duas opções do brief): CORTE POR TIMESTAMP DE ATIVAÇÃO,
    // não "semear" printedIdsRef em bloco no primeiro reconcile. Motivo:
    // semear marcaria cada grupo pré-ativação como "impresso" sem nunca
    // ter impresso nada — infla `printedIdsRef`/o teto de MAX_PRINTED_IDS
    // com entradas que não representam impressão real, e complica o
    // raciocínio sobre o que aquele Set significa. Comparar `updated_at`
    // contra `activatedAtRef` é sem estado extra: um fechamento antes da
    // ativação nunca entra no grupo a imprimir, ponto — não precisa
    // "lembrar" de nada além do que já persiste hoje.
    const activationCutoff = activatedAtRef.current;
    // Fix round 3 (Group A2): compara instantes parseados, não strings.
    // row_to_json (fetch_sales_history_secure) renderiza timestamptz no
    // TimeZone da SESSÃO do Postgres, com dígitos de fração e formato de
    // offset variáveis; toISOString() do JS sempre emite 3 dígitos fixos e
    // "Z". Com o banco em UTC as duas strings comparam na ordem certa só
    // por coincidência de formato — se o TimeZone da sessão do Postgres
    // mudar (postgresql.conf, ou um `SET timezone` por role, no servidor
    // self-hosted), um fechamento carimbado "...T11:05:00-03:00" compara
    // como lexicalmente MENOR que "...T14:00:00.000Z", suprimindo todo
    // recibo genuíno por até 3h depois de cada ativação, com o banner
    // ainda em CONECTADA.
    const cutoffMs = activationCutoff ? new Date(activationCutoff).getTime() : null;
    const tableOrders = orders.filter((o) =>
      o.order_type === 'table' && o.table_id && o.updated_at &&
      (cutoffMs === null || new Date(o.updated_at).getTime() >= cutoffMs)
    );

    const groups = new Map<string, Order[]>();
    for (const o of tableOrders) {
      const key = `${o.table_id}__${o.updated_at}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(o);
    }

    for (const [key, group] of groups) {
      if (printedIdsRef.current.has(key)) continue;
      const fail = failedRef.current.get(key);
      if (fail && fail.attempts >= MAX_AUTO_RETRIES) continue;

      const items = group.flatMap((o) => (o.order_items || []).filter((i) => i.status !== 'canceled'));
      if (items.length === 0) {
        // Mesa fechada sem nenhum item cobrável (ex.: só itens cancelados) —
        // não há comprovante nenhum pra imprimir; marca como "visto" pra não
        // ficar reavaliando o mesmo grupo em todo reconcile().
        printedIdsRef.current.add(key);
        savePrintedIds(s.id, destination, printedIdsRef.current);
        continue;
      }

      // Fix round 3 (Group A1): reconcile() (o chamador) tinha try/finally
      // sem catch, e duas expressões abaixo rodavam SEM proteção nenhuma:
      // calculateChangeForMethods (`.filter` sobre `methods`) e
      // `total.toFixed(2)` (na descrição). close_table_orders_secure
      // (migration 021) aceita jsonb arbitrário de qualquer um com a anon
      // key pública — `payment_details.methods` pode não ser array,
      // `.total` pode não ser number. Se qualquer um lançasse, o throw
      // escapava este `for` inteiro (abortando os grupos restantes do
      // lote, não só este) e propagava até reconcile(), que não tinha
      // catch: setLastReconcileAt/a sinalização de falha nunca rodavam, o
      // banner ficava travado no último estado bom (CONECTADA, que reflete
      // só o websocket — subsistema separado), e cada tick de 10s seguinte
      // batia no mesmo dado e lançava de novo — a estação parava de
      // imprimir QUALQUER pedido, pra sempre, sem nada na tela avisando.
      // Duas camadas de correção: coerção defensiva ANTES de qualquer
      // aritmética/formatação tocar `total`/`methods` (evita o throw na
      // origem, degrada pra "este grupo falhou"), e o try/catch em volta
      // do corpo inteiro do grupo (rede de segurança pra qualquer outra
      // forma de dado malformado não prevista — degrada pro mesmo lugar
      // sem abortar os grupos seguintes). reconcile() também ganhou um
      // catch próprio (ver função abaixo) como última rede, caso algo
      // escape daqui mesmo assim.
      try {
        const subtotal = items.reduce((acc, i) => acc + i.price_at_time * i.quantity, 0);
        const tableNumber = group[0].tables?.number ?? '?';
        const paymentDetails = group[0].payment_details as { total?: number; methods?: { method: string; amount: number; brand?: string | null }[] } | null | undefined;
        const rawTotal = paymentDetails?.total;
        const total = typeof rawTotal === 'number' && Number.isFinite(rawTotal)
          ? rawTotal
          : (Number.isFinite(Number(rawTotal)) ? Number(rawTotal) : subtotal);
        const rawMethods = paymentDetails?.methods;
        const methods = Array.isArray(rawMethods) && rawMethods.length > 0
          ? rawMethods
          : (group[0].payment_method ? [{ method: group[0].payment_method, amount: total }] : []);
        // Fix round 2 (Group A2): extraído para lib/calc.ts
        // (calculateChangeForMethods) — mesma fórmula que estava duplicada
        // verbatim em StoreModule.tsx (handleFinishPayment). Troco é sobre
        // o que o dinheiro precisava cobrir (total menos o que outros
        // métodos já pagaram), nunca sobre o total cheio da conta — senão
        // parte-cartão-parte-dinheiro sempre dava troco zero.
        const changeDue = calculateChangeForMethods(methods, total);
        const description = `Mesa ${tableNumber} — R$ ${total.toFixed(2)}`;

        // Fix round 2 (Group C1): antes este comprovante nunca passava
        // `serviceFee`, e o template só mostra a linha de subtotal/taxa
        // quando esse campo existe (ver lib/print.ts) — resultado real:
        // itens somando R$30,00 seguidos de "TOTAL: R$ 33,00" sem nenhuma
        // explicação pros R$3, enquanto o comprovante do PRÓPRIO caixa
        // (StoreModule.tsx, handleFinishPayment) sempre imprime a
        // discriminação completa pra mesma venda. Reconstituído aqui a
        // partir só do que já temos (sem acesso ao estado local
        // `removedServiceFees` de StoreModule, que nunca é persistido — ver
        // "Remover Taxa" na lista de fora de escopo):
        // - `feeAmount` é a diferença REAL entre total e subtotal já
        //   gravados no pedido (nunca recalculado do zero pela rate — evita
        //   discordar do valor que realmente foi cobrado).
        // - `charged` é `feeAmount > 0`.
        // - `removedForTable` é inferido: loja cobra por padrão
        //   (`s.config?.charge_service_fee`) mas ESTA conta não teve taxa
        //   (`!charged`) só pode significar que foi removida nesta mesa —
        //   sem isso, a estação diria "este estabelecimento não cobra taxa"
        //   pra uma loja que cobra, só não cobrou desta vez.
        const serviceFeeRate = s.config?.service_fee_rate ?? SERVICE_FEE_RATE;
        const feeAmount = Math.max(0, total - subtotal);
        const feeCharged = feeAmount > 0.005;
        const serviceFee: BillServiceFeeInfo = {
          charged: feeCharged,
          rate: serviceFeeRate,
          amount: feeAmount,
          removedForTable: !feeCharged && !!s.config?.charge_service_fee,
        };

        // Fix round 2 (Group B2): mesmo try/catch de reconcileKitchen — uma
        // rejeição não tratada de printBillReceipt abortaria o `for` no meio
        // do lote sem marcar o grupo corrente como falha.
        const doPrint = async () => {
          try {
            return await printBillReceipt({
              storeName: s.name,
              cnpj: s.cnpj,
              label: `MESA ${tableNumber} - COMPROVANTE`,
              items: items.map((i) => ({ quantity: i.quantity, name: getOrderItemDisplayName(i), total: i.price_at_time * i.quantity })),
              subtotal,
              serviceFee,
              total,
              payment: methods.length > 0 ? { methods, changeDue } : undefined,
            });
          } catch (e) {
            console.error('printBillReceipt lançou (tratado como falha):', e);
            return false;
          }
        };
        // eslint-disable-next-line no-await-in-loop -- mesmo motivo do reconcileKitchen: impressão sequencial, nunca dois print() simultâneos.
        const ok = await doPrint();

        if (ok) {
          printedIdsRef.current.add(key);
          savePrintedIds(s.id, destination, printedIdsRef.current);
          if (failedRef.current.has(key)) {
            failedRef.current.delete(key);
            setFailedItems(new Map(failedRef.current));
          }
          pushEvent(s.id, destination, { itemId: key, time: new Date().toISOString(), description, success: true });
        } else {
          const attempts = (fail?.attempts || 0) + 1;
          failedRef.current.set(key, { description, attempts, retry: doPrint });
          setFailedItems(new Map(failedRef.current));
          pushEvent(s.id, destination, { itemId: key, time: new Date().toISOString(), description, success: false });
        }
      } catch (e) {
        console.error('reconcileCaixa: grupo com dado malformado, tratado como falha (não abortou o lote):', e);
        const fallbackDescription = `Mesa ${group[0].tables?.number ?? '?'} — dados de pagamento inválidos`;
        const attempts = (fail?.attempts || 0) + 1;
        failedRef.current.set(key, { description: fallbackDescription, attempts, retry: async () => false });
        setFailedItems(new Map(failedRef.current));
        pushEvent(s.id, destination, { itemId: key, time: new Date().toISOString(), description: fallbackDescription, success: false });
      }
    }
    return fetchFailed;
  }, [pushEvent]);

  // --- Reconciliação: busca o estado real do servidor e imprime o que
  // ainda não foi impresso. É o mecanismo que realmente garante "nenhum
  // pedido perdido" (Passo 2/3 do brief) — a assinatura Realtime abaixo é
  // só um jeito de disparar isto mais rápido, nunca a única fonte. Chamada
  // em 4 gatilhos independentes: ao ativar, a cada ping Realtime, num
  // intervalo fixo (backstop caso o ping se perca), e quando a aba volta a
  // ficar visível/online (aparelho que hibernou ou perdeu rede).
  const reconcile = useCallback(async () => {
    const s = storeRef.current;
    const destination = destinationRef.current;
    if (!s || reconcileLockRef.current) return;
    reconcileLockRef.current = true;
    let fetchFailed = false;
    try {
      const productDestination = productDestinationFor(destination);
      if (productDestination) {
        fetchFailed = await reconcileKitchen(s, destination, productDestination);
      } else if (destination === 'caixa') {
        fetchFailed = await reconcileCaixa(s, destination);
      }
    } catch (e) {
      // Fix round 3 (Group A1): antes desta correção não havia NENHUM catch
      // aqui — só try/finally. reconcileKitchen/reconcileCaixa protegem seus
      // próprios laços de impressão item a item, mas um throw que escapasse
      // os dois mesmo assim (a origem real era `payment_details` malformado
      // dentro de reconcileCaixa, agora coberto por coerção defensiva + seu
      // próprio try/catch — ver função acima) abortava esta função INTEIRA
      // antes de `setLastReconcileAt`/a sinalização de falha rodarem, abaixo.
      // Resultado real: o banner ficava travado no último estado bom
      // (CONECTADA, que reflete só o websocket, um subsistema separado), e
      // cada tick de 10s seguinte tentava reconciliar de novo, batia no
      // mesmo dado, e lançava de novo — a estação parava de imprimir
      // QUALQUER pedido, pra sempre, sem nada na tela avisando. Tratado
      // aqui como falha de reconciliação, mesmo sinal que já existe pra RPC
      // falhando — o banner vermelho (RECONCILE_FAILURE_ALERT_THRESHOLD)
      // alcança este caminho também, e o lock/estado sempre reflete algo
      // (nunca fica "congelado" no meio de uma tentativa).
      console.error('reconcile() lançou (tratado como falha de reconciliação):', e);
      fetchFailed = true;
    } finally {
      // Movido pra dentro do finally (Fix round 3, Group A1): antes rodava
      // só no caminho feliz do try, então um throw pulava isto por completo.
      // Agora roda sempre — sucesso, falha sinalizada pela função chamada,
      // ou exceção pega no catch acima.
      setLastReconcileAt(new Date().toISOString());
      // Fix round 2 (Group B1): a reconciliação em si é a garantia real
      // (ver cabeçalho do arquivo) — não o canal Realtime, que só dispara
      // ela mais rápido. `lastReconcileFailed` reflete a tentativa mais
      // recente (distingue "0 pedidos pendentes" de "não consegui nem
      // perguntar ao servidor"); `persistentReconcileFailure` só liga após
      // falhas seguidas, pra virar o banner vermelho de mesma proeminência
      // do banner de conexão, sem alarme falso num único blip de rede.
      setLastReconcileFailed(fetchFailed);
      reconcileFailStreakRef.current = fetchFailed ? reconcileFailStreakRef.current + 1 : 0;
      setPersistentReconcileFailure(reconcileFailStreakRef.current >= RECONCILE_FAILURE_ALERT_THRESHOLD);
      reconcileLockRef.current = false;
    }
  }, [reconcileKitchen, reconcileCaixa]);

  // Reimpressão manual de um item/grupo que falhou (Passo do brief: "falha
  // de impressão precisa ser visível E recuperável"). Toque explícito do
  // operador = gesto novo, então também contorna qualquer limitação de
  // diálogo repetido do navegador que a tentativa automática possa ter
  // acionado. Genérico desde a Task 4: `entry.retry()` já é a chamada de
  // impressão certa (kitchen ticket ou comprovante de caixa), montada no
  // momento em que a falha foi registrada.
  const retryItem = useCallback(async (key: string) => {
    const s = storeRef.current;
    const destination = destinationRef.current;
    const entry = failedRef.current.get(key);
    if (!s || !entry) return;
    // Fix round 2 (Group B2): `entry.retry` já é `doPrint`, que agora tem
    // seu próprio try/catch nas duas origens (reconcileKitchen/
    // reconcileCaixa) — este try/catch aqui é redundante NA PRÁTICA, mas
    // deliberado: é o ponto de entrada do único caminho de impressão
    // acionado por toque humano direto (não por loop automático), e o
    // brief pede explicitamente proteção aqui também, não só nos loops.
    let ok = false;
    try {
      ok = await entry.retry();
    } catch (e) {
      console.error('Reimpressão manual lançou (tratado como falha):', e);
      ok = false;
    }
    if (ok) {
      printedIdsRef.current.add(key);
      savePrintedIds(s.id, destination, printedIdsRef.current);
      failedRef.current.delete(key);
      setFailedItems(new Map(failedRef.current));
      pushEvent(s.id, destination, { itemId: key, time: new Date().toISOString(), description: entry.description, success: true });
      toast.success('Reimpresso com sucesso.');
    } else {
      failedRef.current.set(key, { ...entry, attempts: 0 }); // zera contagem: reimpressão manual sempre pode tentar de novo depois
      setFailedItems(new Map(failedRef.current));
      toast.error('A reimpressão também falhou. Verifique a impressora.');
    }
  }, [pushEvent]);

  // --- Assinatura Realtime + backstop de intervalo + foco/online -------
  useEffect(() => {
    if (!activated || !store) return;

    reconcile(); // primeira reconciliação imediata ao ativar

    const unsubscribe = subscribeToStoreOrderChanges(store.id, () => reconcile(), setConnectionStatus);

    // Backstop: mesmo com o canal "conectado", nada garante que todo ping
    // chega (rede instável, aba suspensa por um instante) — reconciliar
    // periodicamente é o que de fato cumpre "pedido feito enquanto a
    // estação estava desconectada tem que imprimir ao reconectar" (é mais
    // forte que confiar só no evento de reconexão do canal).
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
  }, [activated, store, reconcile]);

  // --- Handlers da Tela A (configuração) --------------------------------
  const handleSaveConfig = async () => {
    const slug = slugInput.trim().toLowerCase();
    if (!slug) {
      setSetupError('Informe o identificador (slug) da loja.');
      return;
    }
    setSetupError(null);
    setLoadingStore(true);
    const { store: s, error } = await fetchStoreBySlug(slug);
    setLoadingStore(false);
    if (!s) {
      setSetupError(error === 'not_found' ? 'Loja não encontrada para esse identificador.' : 'Erro de conexão. Verifique a internet e tente de novo.');
      return;
    }
    const newConfig: StationConfig = { slug, destination: destinationInput };
    saveConfig(newConfig);
    setConfig(newConfig);
  };

  const handleChangeConfig = async () => {
    if (activated && !(await confirm({
      title: 'Trocar loja/destino',
      message: 'A estação para de imprimir pedidos desta configuração até ser configurada de novo. Confirma?',
      variant: 'danger',
      confirmLabel: 'Trocar',
    }))) return;
    clearConfig();
    setConfig(null);
    setStore(null);
    setActivated(false);
    setSlugInput('');
  };

  // Passo 1 do brief, o núcleo de tudo: navegador não imprime sozinho sem
  // um gesto humano na primeira vez. Este clique É esse gesto — a partir
  // daqui o efeito acima liga a reconciliação/assinatura, e toda impressão
  // seguinte roda de código, sem outro toque.
  //
  // Honestidade sobre o que isto garante de verdade (pedido explícito do
  // brief): `window.print()` (chamado por lib/print.ts dentro do iframe) eu
  // NÃO modifiquei e não sei provar formalmente que um clique aqui
  // "destrava" chamadas futuras pra sempre no sentido técnico de "ativação
  // persistente" do Chromium — o que a pesquisa e o teste em
  // components/modules (ver task-3-report.md) indicam é que
  // `window.print()`, ao contrário de `window.open()`, não é bloqueado por
  // FALTA de gesto pra começo de conversa (não está na lista de APIs
  // gateadas por "transient activation" da Chromium), mas o Chrome tem uma
  // proteção separada de "impedir esta página de criar mais diálogos"
  // acionada por diálogos repetidos SEM interação entre eles — não
  // confirmei se essa proteção também se aplica ao diálogo nativo de
  // impressão (é uma UI diferente de alert/confirm) nem head a head num
  // dispositivo real. Ver task-3-report.md pra o que foi de fato testado.
  const handleActivate = () => {
    // Fix round 2 (Group C2): grava o ref ANTES de `setActivated(true)` —
    // o efeito que assina/reconcilia depende de `activated`, e a ref
    // (ao contrário do state) fica disponível de imediato, sem esperar
    // o próximo render, garantindo que a primeira reconciliação (disparada
    // dentro desse mesmo efeito) já enxergue o cutoff certo.
    const now = new Date().toISOString();
    activatedAtRef.current = now;
    setActivated(true);
    setActivatedAt(now);
  };

  const handleTestPrint = async () => {
    if (!store) return;
    // Módulo Caixa (Task 4): teste de uma estação 'caixa' precisa sair como
    // comprovante (printBillReceipt), não como ticket de cozinha — senão o
    // teste imprime um documento de um tipo que essa estação nunca vai
    // realmente usar, e não prova nada sobre a impressora certa.
    const ok = destinationRef.current === 'caixa'
      ? await printBillReceipt({
          storeName: store.name,
          cnpj: store.cnpj,
          label: 'TESTE - COMPROVANTE',
          items: [{ quantity: 1, name: 'Impressão de teste da estação', total: 0 }],
          subtotal: 0,
          total: 0,
        })
      : await printKitchenTicket({
          kind: productDestinationFor(destinationRef.current) === 'bar' ? 'BAR' : 'COZINHA',
          storeName: store.name,
          orderType: 'TESTE',
          identifier: 'TICKET DE TESTE',
          quantity: 1,
          productName: 'Impressão de teste da estação',
          orderIdShort: 'TESTE',
        });
    if (ok) toast.success('Impressão de teste enviada.');
    else toast.error('A impressão de teste falhou — confira a impressora antes de deixar a estação sozinha.');
  };

  // --- Render ------------------------------------------------------------

  if (config === undefined) return null; // primeiro tick, ainda lendo localStorage — evita flash

  // Config já salva, mas a loja ainda não resolveu (rede lenta/timeout no
  // boot do aparelho) — NÃO mostra o formulário de novo (a config continua
  // salva, só ainda não confirmamos que a loja existe/está acessível): uma
  // tela de espera simples, com retry automático já rodando por trás.
  if (config && !store) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="w-11 h-11 rounded-full bg-[var(--brand)]/10 text-[var(--brand)] flex items-center justify-center mx-auto mb-4">
            <Printer size={22} className={loadingStore ? 'animate-pulse' : ''} />
          </div>
          <h1 className="text-lg font-bold text-[var(--text)] mb-1">Conectando à loja...</h1>
          <p className="text-sm text-[var(--text-muted)] mb-4">{setupError || `Buscando "${config.slug}"...`}</p>
          <button onClick={handleChangeConfig} className="text-xs text-[var(--text-muted)] underline">
            Trocar loja/destino
          </button>
        </Card>
      </div>
    );
  }

  // Tela A — configurar loja/destino
  if (!config) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-11 h-11 rounded-full bg-[var(--brand)]/10 text-[var(--brand)] flex items-center justify-center">
              <Printer size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[var(--text)]">Estação de Impressão</h1>
              <p className="text-xs text-[var(--text-muted)]">Configuração deste aparelho</p>
            </div>
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-4 mb-5">
            Cada aparelho serve UMA loja e UM destino (cozinha, bar ou caixa). Configure uma vez — fica salvo neste navegador.
          </p>

          <Input
            label="Identificador da loja (slug)"
            placeholder="ex.: zz-laboratorio"
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            autoFocus
          />
          <p className="text-[11px] text-[var(--text-muted)] mt-1 mb-4">O mesmo identificador usado no link do cardápio do cliente (norteparanegocios.../c/&lt;slug&gt;).</p>

          <label className="text-xs font-semibold text-[var(--text)]">Destino desta estação</label>
          <div className="grid grid-cols-3 gap-2 mt-2 mb-5">
            {(['cozinha', 'bar', 'caixa'] as StationDestination[]).map((d) => {
              const Icon = DESTINATION_ICON[d];
              const active = destinationInput === d;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setDestinationInput(d)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-semibold transition-colors ${
                    active ? 'bg-[var(--brand)]/10 border-[var(--brand)]/40 text-[var(--brand)]' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)]'
                  }`}
                >
                  <Icon size={20} />
                  {DESTINATION_LABEL[d]}
                </button>
              );
            })}
          </div>

          {setupError && <p className="text-sm text-[var(--err)] mb-4">{setupError}</p>}

          <Button className="w-full" size="lg" onClick={handleSaveConfig} isLoading={loadingStore}>
            Salvar e continuar
          </Button>
        </Card>
      </div>
    );
  }

  if (!store) return null; // inalcançável na prática (os dois blocos acima já cobrem !store) — só satisfaz o narrowing do TS.

  const destination = config.destination;
  const DestIcon = DESTINATION_ICON[destination];
  // Fix round 2 (Group B1): `isConnected` continua refletindo só o canal
  // Realtime (usado no badge pequeno "Reconectando" abaixo) — não muda de
  // nome nem de escopo pra não confundir com a saúde da reconciliação, que
  // é o sinal novo abaixo.
  const isConnected = connectionStatus === 'connected' && online;
  const failedList = Array.from(failedItems.entries());
  const lastEvent = events[0] || null;

  // Tela B — pedir o gesto de ativação
  if (!activated) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6">
        <Card className="w-full max-w-lg p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-[var(--brand)]/10 text-[var(--brand)] flex items-center justify-center mx-auto mb-4">
            <DestIcon size={26} />
          </div>
          <h1 className="text-xl font-bold text-[var(--text)]">{store.name}</h1>
          <p className="text-sm text-[var(--text-muted)] mb-6">Estação de impressão — {DESTINATION_LABEL[destination]}</p>

          <div className="rounded-xl bg-[var(--warn)]/10 text-left p-4 mb-6 text-sm text-[var(--text)]">
            <strong>Por que este botão existe:</strong> o navegador não deixa uma página imprimir sozinha sem uma primeira ação de quem está usando. Toque uma vez abaixo ao abrir esta tela — depois disso, os pedidos novos imprimem sozinhos, sem precisar tocar em mais nada.
          </div>

          <Button size="lg" className="w-full text-base py-4" onClick={handleActivate}>
            <Printer size={20} className="mr-1" /> Ativar impressão
          </Button>

          <button onClick={handleChangeConfig} className="text-xs text-[var(--text-muted)] underline mt-5">
            Trocar loja/destino
          </button>
        </Card>
      </div>
    );
  }

  // Tela C — monitor ativo
  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col">
      {/* Faixa de status — o requisito mais importante da tela: precisa dar
          pra ver "conectada ou não" de longe, sem precisar ler texto
          pequeno. Cor de fundo cheia (não só um badge), texto grande. */}
      <div
        className={`w-full py-4 px-6 flex items-center justify-center gap-3 text-white transition-colors ${
          isConnected ? 'bg-[var(--ok)]' : 'bg-[var(--err)] animate-pulse'
        }`}
      >
        {isConnected ? <Wifi size={26} /> : <WifiOff size={26} />}
        <span className="text-xl md:text-2xl font-extrabold tracking-wide">
          {isConnected ? 'CONECTADA' : 'SEM CONEXÃO — PEDIDOS PODEM NÃO ESTAR CHEGANDO'}
        </span>
      </div>

      {/* Fix round 2 (Group B1): banner SEPARADO, mesma proeminência do de
          conexão acima (mesma altura, mesmo peso de texto, cor de fundo
          cheia) — porque é um sinal de subsistema diferente. O banner
          acima só reflete o canal Realtime; este reflete se a estação
          CONSEGUE de fato perguntar ao servidor o que está pendente
          (fetch_kitchen_orders_secure/fetch_sales_history_secure). Websocket
          conectado + RPC persistentemente falhando é um estado real e
          distinto (dois subsistemas separados do Supabase) — sem este
          banner, esse cenário mostrava CONECTADA em verde enquanto nada
          era impresso, exatamente o desastre que esta tela existe pra
          evitar. Só aparece depois de RECONCILE_FAILURE_ALERT_THRESHOLD
          falhas seguidas, pra não virar alarme falso num blip de rede. */}
      {persistentReconcileFailure && (
        <div className="w-full py-4 px-6 flex items-center justify-center gap-3 text-white bg-[var(--err)] animate-pulse">
          <XCircle size={26} />
          <span className="text-xl md:text-2xl font-extrabold tracking-wide text-center">
            FALHA AO BUSCAR PEDIDOS NO SERVIDOR — AVISE O SUPORTE
          </span>
        </div>
      )}

      <div className="max-w-3xl w-full mx-auto p-6 flex-1">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-[var(--brand)]/10 text-[var(--brand)] flex items-center justify-center">
              <DestIcon size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[var(--text)]">{store.name}</h1>
              <p className="text-xs text-[var(--text-muted)]">
                {DESTINATION_LABEL[destination]} · Ativa desde {activatedAt ? formatTime(activatedAt) : '—'}
              </p>
            </div>
          </div>
          <Badge color="bg-[var(--ok)]/10 text-[var(--ok)]" dot pulse={isConnected}>
            {isConnected ? 'Imprimindo automaticamente' : 'Reconectando'}
          </Badge>
        </div>

        {/* Fix round 2 (Group C3): a estação de caixa só imprime de fato
            quando `print_target` da loja é 'station' (ver reconcileCaixa) —
            este card deixa isso visível pro operador em vez de a estação
            ficar silenciosamente ociosa sem explicação nenhuma. */}
        {destination === 'caixa' && (
          resolvePrintTarget(store) === 'station' ? (
            <Card className="p-4 mb-6 bg-[var(--info)]/5 border-[var(--info)]/20">
              <p className="text-sm text-[var(--text)]">
                Esta estação imprime o comprovante automaticamente sempre que uma mesa é fechada pelo caixa
                (Gestão de Mesas → Receber Pagamento). Nada pra fazer aqui além de manter a impressora ligada.
              </p>
            </Card>
          ) : (
            <Card className="p-4 mb-6 border-[var(--warn)]/40 bg-[var(--warn)]/10">
              <p className="text-sm text-[var(--text)]">
                <strong>Esta estação está ociosa.</strong> A loja "{store.name}" está configurada pra imprimir
                comprovante no próprio aparelho do caixa (destino de impressão "Aparelho"), não numa estação —
                pra ativar a impressão automática aqui, mude o destino de impressão da loja pra "Estação" no
                Painel Master. Enquanto isso, nada será impresso nesta tela pra evitar imprimir a mesma conta
                duas vezes.
              </p>
            </Card>
          )
        )}

        {failedList.length > 0 && (
          <Card className="p-4 mb-6 border-[var(--err)]/40 bg-[var(--err)]/5">
            <div className="flex items-center gap-2 mb-3 text-[var(--err)] font-bold text-sm">
              <XCircle size={18} /> {failedList.length} impressão(ões) falharam — avise {destination === 'caixa' ? 'o caixa' : 'a cozinha'} manualmente e reimprima
            </div>
            <div className="space-y-2">
              {failedList.map(([key, entry]) => (
                <div key={key} className="flex items-center justify-between gap-3 bg-[var(--surface)] rounded-lg p-3 border border-[var(--border)]">
                  <span className="text-sm text-[var(--text)] truncate">{entry.description}</span>
                  <Button size="sm" variant="danger" onClick={() => retryItem(key)}>
                    <RotateCcw size={14} className="mr-1" /> Reimprimir
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-5 mb-6">
          <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Última impressão</h2>
          {lastEvent ? (
            <div className="flex items-center gap-3">
              {lastEvent.success ? <CheckCircle2 size={20} className="text-[var(--ok)] flex-shrink-0" /> : <XCircle size={20} className="text-[var(--err)] flex-shrink-0" />}
              <div className="min-w-0">
                <p className="text-base font-semibold text-[var(--text)] truncate">{lastEvent.description}</p>
                <p className="text-xs text-[var(--text-muted)]">{formatTime(lastEvent.time)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">Nenhum pedido impresso ainda nesta configuração.</p>
          )}
        </Card>

        {events.length > 1 && (
          <Card className="p-5 mb-6">
            <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">Histórico recente</h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {events.slice(1).map((ev, i) => (
                <div key={`${ev.itemId}-${i}`} className="flex items-center gap-3 text-sm">
                  {ev.success ? <CheckCircle2 size={14} className="text-[var(--ok)] flex-shrink-0" /> : <XCircle size={14} className="text-[var(--err)] flex-shrink-0" />}
                  <span className="text-[var(--text-muted)] flex-shrink-0">{formatTime(ev.time)}</span>
                  <span className="text-[var(--text)] truncate">{ev.description}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
          {/* Fix round 2 (Group B1): distingue "0 pedidos pendentes" (ícone
              de relógio neutro, texto muted) de "a última tentativa falhou
              em CONSULTAR o servidor" (ícone vermelho, texto vermelho) —
              antes os dois casos produziam o mesmo texto neutro
              "Última verificação: HH:MM:SS", indistinguíveis. */}
          <span className={`flex items-center gap-1.5 ${lastReconcileFailed ? 'text-[var(--err)] font-semibold' : ''}`}>
            {lastReconcileFailed ? <XCircle size={13} /> : <Clock size={13} />}
            Última verificação: {lastReconcileAt ? formatTime(lastReconcileAt) : 'aguardando...'}
            {lastReconcileFailed && ' — falhou ao consultar o servidor'}
          </span>
          <div className="flex items-center gap-4">
            <button onClick={handleTestPrint} className="underline flex items-center gap-1">
              <Printer size={13} /> Imprimir teste
            </button>
            <button onClick={handleChangeConfig} className="underline flex items-center gap-1">
              <Settings size={13} /> Trocar loja/destino
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
