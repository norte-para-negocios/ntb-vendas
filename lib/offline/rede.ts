// Rede local entre os computadores da loja (08/10/2026, pedido do dono: sem internet, todos trocam informação pelo
// Wi-Fi/cabo, sem um computador central). O app do Windows (electron/lan-peer.js) acha os outros computadores da mesma
// loja e troca as filas "sem internet" de cada um. Aqui:
//  - a tela usa a MINHA fila + a dos OUTROS (mesas, pedidos, pedir conta, pagamento aparecem em todos);
//  - quando a internet volta, cada um sobe a própria fila, na ordem entre computadores: uma ação espera as ações
//    anteriores DA MESMA MESA que ainda estão na fila de outro computador vivo (ex.: o caixa só fecha a mesa no servidor
//    depois que o pedido feito no outro computador subiu); computador que sumiu há mais de 2 min tem as ações
//    "seguras de repetir" (pedido com id próprio, abrir mesa, pedir conta) subidas por quem está vivo.
//  - quem subiu uma ação (minha ou adotada) anuncia o id; quem a criou vê e tira da fila sem mandar de novo.
// Navegador comum (sem o app do Windows): nada disso liga, a fila continua só local como antes.
import type { QueuedAction } from './types';

export type AcaoRede = QueuedAction & { origem?: string; origemVistaEm?: number };

type LanApi = {
  iniciar: (p: { storeId: string; peerId: string }) => Promise<{ ok: boolean }>;
  publicar: (p: { acoes?: unknown[]; sincronizadas?: string[] }) => Promise<unknown>;
  ler: () => Promise<{ ok: boolean; acoes: AcaoRede[]; sincronizadas: string[]; computadores: number }>;
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

/** Liga a troca com os outros computadores (só no app do Windows). Publica a minha fila e lê a dos outros a cada 1 s (e na hora que a fila muda). */
export async function iniciarRedeLocal(storeId: string, minhaFila: () => Promise<QueuedAction[]>): Promise<void> {
  const api = lan();
  if (!api || ligada) return;
  ligada = true;
  await api.iniciar({ storeId, peerId: meuIdNaRede() }).catch(() => null);
  const ciclo = async () => {
    try {
      const minhas = (await minhaFila()).filter((a) => !a.payload || (a.payload as Record<string, unknown>).p_store_id === undefined || (a.payload as Record<string, unknown>).p_store_id === storeId);
      await api.publicar({ acoes: minhas, sincronizadas: lerSubidas() });
      const r = await api.ler();
      if (r?.ok) outros = { acoes: r.acoes || [], subidas: new Set(r.sincronizadas || []), computadores: r.computadores || 0 };
    } catch { /* tenta no próximo ciclo */ }
  };
  await ciclo();
  setInterval(ciclo, 1000);
  try { window.addEventListener('ntb-fila-mudou', () => { void ciclo(); }); } catch { /* */ }
}
