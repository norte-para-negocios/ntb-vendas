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
// pra cobrir os 2 caminhos que HOJE não têm "aparelho próprio" pra imprimir
// no momento em que o pedido é criado — o autoatendimento do cliente via QR
// e o Balcão. O caminho do garçom lançando manualmente (`TablesView.
// handleAddItem`, Task 2) já imprime na hora, na mesma sessão que criou o
// pedido, e CONTINUA assim, sem mudança nenhuma — não duplicado aqui porque
// esses itens são gravados com `added_by_role: 'garcom'`
// (`order_items.added_by_role`, migration 046) e a reconciliação abaixo
// ignora esse valor de propósito (ver `reconcileDestination`).
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
import { fetchKitchenOrders, subscribeToStoreOrderChanges, StoreOrdersConnectionStatus } from '@/lib/api';
import { printKitchenTicket } from '@/lib/print';
import { resolveOrderFlow } from '@/lib/storeModules';
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

// `caixa-permission`: dono/universal sempre contam (mesmo bypass já usado em
// canFinalizeBill, lib/storeModules.ts) — quem realmente decide se este
// mecanismo roda numa loja SEM módulo Caixa configurado (as 7 lojas reais de
// hoje) é `resolveOrderFlow(store) === 'direct_print'`, que nenhuma delas
// tem. Um garçom comum (sem a permissão `caixa`) NUNCA ativa isto, mesmo
// numa loja em direct_print — só o(s) operador(es) de caixa (ou dono/
// universal testando) rodam a reconciliação em segundo plano.
function isCaixaRole(user: Pick<StoreUser, 'role' | 'permissions'>): boolean {
  return user.role === 'owner' || user.role === 'universal' || user.permissions?.caixa === true;
}

async function reconcileDestination(
  storeId: string,
  destination: Destination,
  storeName: string,
  printedIdsRef: React.MutableRefObject<Record<Destination, Set<string>>>,
  failedRef: React.MutableRefObject<Map<string, FailedEntry>>,
  setFailedItems: (m: Map<string, FailedEntry>) => void,
): Promise<boolean> {
  let fetchFailed = false;
  const items = await fetchKitchenOrders(storeId, destination, () => { fetchFailed = true; });
  const printedIds = printedIdsRef.current[destination];
  // `added_by_role !== 'garcom'` é o que impede duplicar o ticket que
  // TablesView.handleAddItem já imprimiu na hora, na sessão de quem lançou
  // (garçom OU o próprio caixa lançando manualmente) — ver cabeçalho do
  // arquivo. Cobre exatamente o que sobra: autoatendimento do cliente (QR,
  // `added_by_role: 'cliente'`, default) e Balcão (mesma origem/valor).
  const toPrint = items.filter((it) => !printedIds.has(it.id) && it.added_by_role !== 'garcom');

  for (const item of toPrint) {
    const key = `${destination}:${item.id}`;
    const fail = failedRef.current.get(key);
    if (fail && fail.attempts >= MAX_AUTO_RETRIES) continue; // aguardando reimpressão manual
    const kind = destination === 'bar' ? 'BAR' : 'COZINHA';
    const orderType = item.order?.order_type;
    const tableNumber = item.order?.tables?.number;
    const description = ticketDescription(item);
    const doPrint = async () => {
      // try/catch: printKitchenTicket é Promise<boolean>, não um contrato
      // blindado contra throw — sem isto, uma rejeição não tratada
      // interromperia o `for` no meio do lote (achado real do station
      // original, fix round 2 Group B2).
      try {
        return await printKitchenTicket({
          kind,
          storeName,
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
    // eslint-disable-next-line no-await-in-loop -- impressão sequencial de propósito: dois print() quase simultâneos empilhariam diálogos nativos no mesmo instante.
    const ok = await doPrint();

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

  // Recarrega o dedupe (localStorage) sempre que a loja muda — cobre tanto
  // "loja resolveu depois do login" quanto "conta universal trocou de loja".
  useEffect(() => {
    storeRef.current = store;
    if (!store) return;
    printedIdsRef.current = {
      kitchen: loadPrintedIds(store.id, 'kitchen'),
      bar: loadPrintedIds(store.id, 'bar'),
    };
    failedRef.current = new Map();
    setFailedItemsState(new Map());
  }, [store?.id]);

  const reconcile = useCallback(async () => {
    const s = storeRef.current;
    if (!s || reconcileLockRef.current) return;
    reconcileLockRef.current = true;
    let fetchFailed = false;
    try {
      for (const destination of ['kitchen', 'bar'] as const) {
        // eslint-disable-next-line no-await-in-loop -- sequencial de propósito, mesmo motivo do print sequencial dentro de reconcileDestination.
        const failed = await reconcileDestination(s.id, destination, s.name, printedIdsRef, failedRef, setFailedItemsState);
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
    const unsubscribe = subscribeToStoreOrderChanges(store.id, () => reconcile(), setConnectionStatus);
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
export const CaixaPrintStationIndicator: React.FC<{ status: CaixaPrintStationState; className?: string }> = ({ status, className }) => {
  const [showDetails, setShowDetails] = useState(false);
  if (!status.active) return null;

  const isConnected = status.connectionStatus === 'connected' && status.online;
  const hasFailures = status.failedItems.length > 0;
  // Falha na própria consulta ao servidor (distinto de "0 pedidos
  // pendentes") também acende o indicador, mesmo sem nenhum item na lista
  // de falhas — é exatamente o caso que o `onError` de fetchKitchenOrders
  // existe pra não deixar passar em silêncio.
  const isAlarmed = hasFailures || status.persistentReconcileFailure || !isConnected;

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
            Imprime sozinha, em segundo plano, o pedido do próprio cliente (QR) e do Balcão — o que o garçom lança manualmente já imprime na hora, sem passar por aqui.
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
