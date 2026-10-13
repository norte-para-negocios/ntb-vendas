// Rede local entre os computadores da loja (08/10/2026, pedido do dono: sem internet, todos trocam informação pelo
// Wi-Fi/cabo, sem um computador central). O app do Windows (electron/lan-peer.js) acha os outros computadores da mesma
// loja e troca as filas "sem internet" de cada um. Aqui:
//  - a tela usa a MINHA fila + a dos OUTROS (mesas, pedidos, pedir conta, pagamento aparecem em todos);
//  - quando a internet volta, cada um sobe a própria fila, na ordem entre computadores: uma ação espera as ações
//    anteriores DA MESMA MESA que ainda estão na fila de outro computador vivo (ex.: o caixa só fecha a mesa no servidor
//    depois que o pedido feito no outro computador subiu); computador que sumiu há mais de 2 min tem as ações
//    "seguras de repetir" (pedido com id próprio, abrir mesa, pedir conta) subidas por quem está vivo.
//  - quem subiu uma ação (minha ou adotada) anuncia o id; quem a criou vê e tira da fila sem mandar de novo.
// App do Android (13/10/2026): entra na mesma troca por HTTP com os computadores (lanCelular.ts, exposto como
// `electronApp.lan` pelo NtbBridgeInit); o computador também conta ao celular os caixas abertos e imprime o pedido que o
// celular fez sem internet.
// Navegador comum (sem app): nada disso liga, a fila continua só local como antes.
import type { QueuedAction } from './types';
import type { CaixaNaRede, TicketCelular } from './lanCelular';

export type AcaoRede = QueuedAction & { origem?: string; origemVistaEm?: number };

type PedidoDeImpressao = { id: string; tickets: TicketCelular[] };
type LanApi = {
  iniciar: (p: { storeId: string; peerId: string }) => Promise<{ ok: boolean }>;
  publicar: (p: { acoes?: unknown[]; sincronizadas?: string[]; caixas?: CaixaNaRede[]; impressos?: string[] }) => Promise<unknown>;
  ler: () => Promise<{ ok: boolean; acoes: AcaoRede[]; sincronizadas: string[]; computadores: number; imprimir?: PedidoDeImpressao[] }>;
  // só no celular:
  caixas?: () => Map<string, CaixaNaRede>;
  imprimir?: (id: string, tickets: TicketCelular[]) => Promise<boolean>;
};
const lan = (): LanApi | null => (typeof window !== 'undefined' ? ((window as unknown as { electronApp?: { lan?: LanApi } }).electronApp?.lan ?? null) : null);

export const LIMITE_COMPUTADOR_SUMIDO_MS = 2 * 60 * 1000;
export const ADOTAVEIS = new Set(['create_order', 'open_table_manually', 'request_table_bill', 'cancel_table_bill_request']);

// ----------------------------------------------------------------------------------------------- parte pura (testada)
/** Mesa que a ação mexe (para a ordem entre computadores). */
export function mesaDaAcao(a: { type: string; payload: unknown }): string | null {
  const p = (a.payload ?? {}) as Record<string, unknown>;
  const id = (p.p_table_id ?? p.tableId) as string | undefined;
  return typeof id === 'string' && id ? id : null;
}

/** Junta a minha fila com a dos outros (sem repetir; a minha vence), tira o que alguém já subiu, em ordem de tempo. */
export function juntarFilas(minhas: AcaoRede[], outros: AcaoRede[], jaSubidas: Set<string>): AcaoRede[] {
  const porId = new Map<string, AcaoRede>();
  for (const a of outros) if (!jaSubidas.has(a.id)) porId.set(a.id, a);
  for (const a of minhas) if (!jaSubidas.has(a.id)) porId.set(a.id, a);
  return [...porId.values()].sort((x, y) => x.createdAt - y.createdAt);
}

/**
 * Plano da sincronização desta rodada: o que subir agora (minhas + adotadas de computador sumido), na ordem.
 * Uma ação espera se há ação ANTERIOR da mesma mesa em outro computador vivo (ou ação anterior da mesma mesa que ficou
 * esperando nesta rodada).
 */
export function planejarSincronizacao(minhas: AcaoRede[], outros: AcaoRede[], jaSubidas: Set<string>, agora: number): { subir: AcaoRede[]; esperando: AcaoRede[]; jaFeitas: AcaoRede[] } {
  const jaFeitas = minhas.filter((a) => jaSubidas.has(a.id));
  // Ação do outro que já falhou 3x (erro de regra, parada para o operador) não prende ninguém.
  const vivas = outros.filter((a) => !jaSubidas.has(a.id) && (a.attempts ?? 0) < 3);
  const sumido = (a: AcaoRede) => !a.origemVistaEm || agora - a.origemVistaEm > LIMITE_COMPUTADOR_SUMIDO_MS;
  const candidatas = [
    ...minhas.filter((a) => !jaSubidas.has(a.id)),
    ...vivas.filter((a) => sumido(a) && ADOTAVEIS.has(a.type) && !minhas.some((m) => m.id === a.id)),
  ].sort((x, y) => x.createdAt - y.createdAt);
  const mesasTravadas = new Set<string>();
  const subir: AcaoRede[] = []; const esperando: AcaoRede[] = [];
  for (const a of candidatas) {
    const mesa = mesaDaAcao(a);
    const anteriorVivaDeOutro = mesa != null && vivas.some((o) => o.id !== a.id && !sumido(o) && mesaDaAcao(o) === mesa && o.createdAt < a.createdAt);
    if (mesa != null && (mesasTravadas.has(mesa) || anteriorVivaDeOutro)) { esperando.push(a); mesasTravadas.add(mesa); continue; }
    subir.push(a);
  }
  return { subir, esperando, jaFeitas };
}

// ------------------------------------------------------------------------------------------------------- ao vivo
const CHAVE_PEER = 'ntb-lan-peer-id';
const CHAVE_SUBIDAS = 'ntb-lan-subidas';
let outros: { acoes: AcaoRede[]; subidas: Set<string>; computadores: number } = { acoes: [], subidas: new Set(), computadores: 0 };
let ligada = false;

export function meuIdNaRede(): string {
  try {
    let id = localStorage.getItem(CHAVE_PEER);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(CHAVE_PEER, id); }
    return id;
  } catch { return 'sem-id'; }
}
function lerSubidas(): string[] {
  try { const l = JSON.parse(localStorage.getItem(CHAVE_SUBIDAS) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
}
/** Anota que esta ação (minha ou adotada) já subiu para o servidor; os outros computadores tiram da fila deles. */
export function anotarSubida(id: string): void {
  try { localStorage.setItem(CHAVE_SUBIDAS, JSON.stringify([...lerSubidas().filter((x) => x !== id), id].slice(-2000))); } catch { /* */ }
}
/** Ids que JÁ subiram (por mim ou por outro computador). */
export function idsJaSubidos(): Set<string> {
  return new Set([...lerSubidas(), ...outros.subidas]);
}
/** Ações sem internet dos OUTROS computadores, ainda não subidas. */
export function acoesDosOutros(): AcaoRede[] {
  const subidas = idsJaSubidos();
  return outros.acoes.filter((a) => !subidas.has(a.id));
}
export function computadoresNaRede(): number { return outros.computadores; }

/** Caixa (aberto ou fechado) que os computadores da loja conhecem para este operador, se o celular está falando com algum. */
export function turnoNaRede(storeId: string, operatorUserId: string | null): CaixaNaRede | undefined {
  const api = lan();
  return api?.caixas?.().get(`${storeId}::${operatorUserId ?? 'universal'}`);
}
/** Celular sem internet: manda os papéis do pedido para um computador da loja imprimir. */
export async function imprimirPeloComputador(id: string, tickets: TicketCelular[]): Promise<boolean> {
  const api = lan();
  if (!api?.imprimir) return false;
  return api.imprimir(id, tickets).catch(() => false);
}

const CHAVE_IMPRESSOS_CELULAR = 'ntb-lan-impressos-celular';
function lerImpressosCelular(): string[] {
  try { const l = JSON.parse(localStorage.getItem(CHAVE_IMPRESSOS_CELULAR) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
}

/** Liga a troca com os outros computadores (app do Windows e do Android). Publica a minha fila e lê a dos outros a cada 1 s (e na hora que a fila muda).
 *  No Windows: `caixas` publica os caixas que este computador conhece (o celular lê) e `imprimirTickets` imprime o pedido que o celular mandou. */
export async function iniciarRedeLocal(storeId: string, minhaFila: () => Promise<QueuedAction[]>, extras: { caixas?: () => Promise<CaixaNaRede[]>; imprimirTickets?: (t: TicketCelular[]) => Promise<number> } = {}): Promise<void> {
  let api = lan();
  // No Android a ponte (`electronApp.lan`) é montada num efeito da página: espera até 10 s por ela.
  for (let i = 0; !api && i < 10 && typeof window !== 'undefined' && (window as unknown as { Capacitor?: unknown }).Capacitor; i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((ok) => setTimeout(ok, 1000));
    api = lan();
  }
  if (!api || ligada) return;
  ligada = true;
  await api.iniciar({ storeId, peerId: meuIdNaRede() }).catch(() => null);
  let imprimindo = false;
  const ciclo = async () => {
    try {
      const minhas = (await minhaFila()).filter((a) => !a.payload || (a.payload as Record<string, unknown>).p_store_id === undefined || (a.payload as Record<string, unknown>).p_store_id === storeId);
      const caixas = extras.caixas ? await extras.caixas().catch(() => undefined) : undefined;
      await api.publicar({ acoes: minhas, sincronizadas: lerSubidas(), ...(caixas ? { caixas } : {}) });
      const r = await api.ler();
      if (r?.ok) outros = { acoes: r.acoes || [], subidas: new Set(r.sincronizadas || []), computadores: r.computadores || 0 };
      // Pedido do celular sem internet chegou a este computador: imprime uma vez só (marca guardada) e avisa que saiu.
      if (r?.imprimir?.length && extras.imprimirTickets && !imprimindo) {
        imprimindo = true;
        try {
          const feitos = lerImpressosCelular();
          const novos = r.imprimir.filter((p) => !feitos.includes(p.id));
          for (const p of novos) {
            // eslint-disable-next-line no-await-in-loop -- um pedido por vez, na ordem
            const n = await extras.imprimirTickets(p.tickets).catch(() => 0);
            try { console.log(`[lan] pedido do celular ${p.id}: ${n} papel(is) impresso(s)`); } catch { /* */ }
            try { localStorage.setItem(CHAVE_IMPRESSOS_CELULAR, JSON.stringify([...lerImpressosCelular(), p.id].slice(-500))); } catch { /* */ }
          }
          await api.publicar({ impressos: r.imprimir.map((p) => p.id) });
        } finally { imprimindo = false; }
      }
    } catch { /* tenta no próximo ciclo */ }
  };
  await ciclo();
  setInterval(ciclo, 1000);
  try { window.addEventListener('ntb-fila-mudou', () => { void ciclo(); }); } catch { /* */ }
}
