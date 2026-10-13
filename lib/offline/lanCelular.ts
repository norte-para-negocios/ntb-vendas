// Celular na rede da loja (13/10/2026, pedido do dono: "tá todo mundo no mesmo Wi-Fi, não faz sentido ele cair").
// O app do Windows já troca a fila "sem internet" com os outros computadores (electron/lan-peer.js + rede.ts). O app do
// Android não escuta UDP, então aqui ele fala por HTTP direto com os computadores da loja (porta 47610):
//  - acha os computadores: endereços já conhecidos (guardados no aparelho) e, se nenhum responde, varre a faixa de IP
//    das impressoras de rede da loja (é a mesma rede do Wi-Fi), no máximo 1x por minuto;
//  - a cada 1,5 s: lê a fila e os caixas abertos de cada computador (GET /acoes) e entrega a fila dele (POST /celular);
//  - pedido feito sem internet: manda os papéis para UM computador imprimir (POST /imprimir).
// Implementa a mesma interface `lan` do app do Windows, então rede.ts / pendingOrders.ts / sync.ts não mudam.
// Sem servidor nenhum: só a rede local. Com internet isto continua ligado (só as filas ficam vazias).

export type HttpNativo = (o: { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; data?: unknown; connectTimeout?: number; readTimeout?: number }) => Promise<{ status: number; data: unknown }>;

export type TicketCelular = { destination: 'kitchen' | 'bar'; sectorId?: string | null; title: string; content: string; sig: string };
export type CaixaNaRede = { key: string; shift: unknown | null; updatedAt: number };

const PORTA = 47610;
const CICLO_MS = 1500;
const VARREDURA_INTERVALO_MS = 60_000;
const SEM_RESPOSTA_MS = 20_000;

type Pc = { ip: string; porta: number; peerId?: string; visto: number };
type Remoto = { acoes: unknown[]; sincronizadas: string[]; caixas: CaixaNaRede[]; em: number };

// ----------------------------------------------------------------------------------------------- parte pura (testada)
/** Faixas /24 a varrer: das impressoras de rede e dos computadores já vistos (só IPv4 privado). */
export function faixasParaVarrer(ips: string[]): string[] {
  const faixas = new Set<string>();
  for (const ip of ips) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec((ip || '').trim());
    if (!m) continue;
    const [a, b] = [Number(m[1]), Number(m[2])];
    const privado = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    if (privado) faixas.add(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return [...faixas].slice(0, 4);
}

/** Caixa mais recente por chave (loja::operador) entre todos os computadores. */
export function juntarCaixas(listas: CaixaNaRede[][]): Map<string, CaixaNaRede> {
  const m = new Map<string, CaixaNaRede>();
  for (const l of listas) for (const c of l || []) {
    if (!c || typeof c.key !== 'string') continue;
    const atual = m.get(c.key);
    if (!atual || (c.updatedAt || 0) > (atual.updatedAt || 0)) m.set(c.key, c);
  }
  return m;
}

// ------------------------------------------------------------------------------------------------------- ao vivo
export function criarLanCelular(http: HttpNativo) {
  let st: { storeId: string; peerId: string; pcs: Map<string, Pc>; remotos: Map<string, Remoto>; minhas: unknown[]; sincronizadas: string[]; ultimaResposta: number; ultimaVarredura: number; varrendo: boolean; timer?: ReturnType<typeof setInterval> } | null = null;

  const chavePcs = (storeId: string) => `ntb-lan-pcs:${storeId}`;
  const guardarPcs = () => {
    if (!st) return;
    try { localStorage.setItem(chavePcs(st.storeId), JSON.stringify([...st.pcs.values()].sort((a, b) => b.visto - a.visto).slice(0, 10))); } catch { /* */ }
  };
  const url = (pc: Pc, caminho: string) => `http://${pc.ip}:${pc.porta}${caminho}`;
  const cabecalho = () => ({ 'x-ntb-loja': st!.storeId, 'content-type': 'application/json' });

  const conversar = async (pc: Pc): Promise<boolean> => {
    if (!st) return false;
    try {
      const r = await http({ url: url(pc, '/acoes'), method: 'GET', headers: cabecalho(), connectTimeout: 1200, readTimeout: 1500 });
      if (r.status !== 200 || !r.data) return false;
      const d = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as { peerId?: string; acoes?: unknown[]; sincronizadas?: string[]; caixas?: CaixaNaRede[]; computadores?: { ip: string; porta: number }[] };
      if (!d.peerId) return false;
      const agora = Date.now();
      pc.peerId = d.peerId; pc.visto = agora;
      st.ultimaResposta = agora;
      st.remotos.set(d.peerId, { acoes: d.acoes || [], sincronizadas: d.sincronizadas || [], caixas: d.caixas || [], em: agora });
      // Outros computadores que este conhece pela rede dele (UDP): o celular passa a falar com eles também.
      for (const o of d.computadores || []) {
        const k = `${o.ip}:${o.porta}`;
        if (o?.ip && !st.pcs.has(k)) st.pcs.set(k, { ip: o.ip, porta: o.porta || PORTA, visto: 0 });
      }
      await http({ url: url(pc, '/celular'), method: 'POST', headers: cabecalho(), data: { peerId: st.peerId, acoes: st.minhas, sincronizadas: st.sincronizadas }, connectTimeout: 1200, readTimeout: 1500 }).catch(() => null);
      return true;
    } catch { return false; }
  };

  const varrer = async () => {
    if (!st || st.varrendo) return;
    st.varrendo = true; st.ultimaVarredura = Date.now();
    try {
      let impressoras: string[] = [];
      try { impressoras = (JSON.parse(localStorage.getItem(`ntb-printers-cache:${st.storeId}`) || '[]') as { ip_address?: string }[]).map((p) => p.ip_address || ''); } catch { /* */ }
      const faixas = faixasParaVarrer([...impressoras, ...[...st.pcs.values()].map((p) => p.ip)]);
      const alvos: Pc[] = [];
      for (const f of faixas) for (let h = 1; h <= 254; h++) alvos.push({ ip: `${f}.${h}`, porta: PORTA, visto: 0 });
      let i = 0;
      const trabalhador = async () => {
        while (st && i < alvos.length) {
          const pc = alvos[i++];
          try {
            const r = await http({ url: url(pc, '/acoes'), method: 'GET', headers: cabecalho(), connectTimeout: 700, readTimeout: 900 });
            if (r.status === 200 && st) { pc.visto = Date.now(); st.pcs.set(`${pc.ip}:${pc.porta}`, pc); }
          } catch { /* ninguém aqui */ }
        }
      };
      await Promise.all(Array.from({ length: 32 }, trabalhador));
      guardarPcs();
    } finally { if (st) st.varrendo = false; }
  };

  const ciclo = async () => {
    if (!st) return;
    const pcs = [...st.pcs.values()];
    const respostas = await Promise.all(pcs.map((pc) => conversar(pc)));
    if (respostas.some(Boolean)) guardarPcs();
    // Ninguém respondeu há um tempo: procura na rede. Uma vez ao abrir; depois só sem servidor (no máximo 1x por minuto),
    // para não varrer a rede à toa com internet boa e nenhum computador ligado.
    const semServidor = Boolean((globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt);
    if (Date.now() - st.ultimaResposta > SEM_RESPOSTA_MS && (st.ultimaVarredura === 0 || (semServidor && Date.now() - st.ultimaVarredura > VARREDURA_INTERVALO_MS))) void varrer();
    for (const [id, r] of st.remotos) if (Date.now() - r.em > 10 * 60 * 1000) st.remotos.delete(id);
  };

  return {
    async iniciar({ storeId, peerId }: { storeId: string; peerId: string }) {
      if (st && st.storeId === storeId) return { ok: true };
      if (st?.timer) clearInterval(st.timer);
      const pcs = new Map<string, Pc>();
      try { for (const p of JSON.parse(localStorage.getItem(chavePcs(storeId)) || '[]') as Pc[]) if (p?.ip) pcs.set(`${p.ip}:${p.porta || PORTA}`, { ...p, porta: p.porta || PORTA }); } catch { /* */ }
      st = { storeId, peerId, pcs, remotos: new Map(), minhas: [], sincronizadas: [], ultimaResposta: 0, ultimaVarredura: 0, varrendo: false };
      st.timer = setInterval(() => { void ciclo(); }, CICLO_MS);
      void ciclo();
      return { ok: true };
    },
    async publicar({ acoes, sincronizadas }: { acoes?: unknown[]; sincronizadas?: string[] }) {
      if (!st) return { ok: false };
      if (Array.isArray(acoes)) st.minhas = acoes;
      if (Array.isArray(sincronizadas)) st.sincronizadas = sincronizadas.slice(-2000);
      return { ok: true };
    },
    async ler() {
      if (!st) return { ok: false, acoes: [], sincronizadas: [], computadores: 0 };
      const acoes: unknown[] = []; const sinc = new Set<string>();
      for (const [id, r] of st.remotos) {
        for (const a of r.acoes) acoes.push({ ...(a as object), origem: id, origemVistaEm: r.em });
        for (const s of r.sincronizadas) sinc.add(s);
      }
      const vivos = [...st.remotos.values()].filter((r) => Date.now() - r.em < SEM_RESPOSTA_MS).length;
      return { ok: true, acoes, sincronizadas: [...sinc], computadores: vivos };
    },
    /** Caixas abertos (ou fechados) que os computadores da loja conhecem, o mais recente por chave. */
    caixas(): Map<string, CaixaNaRede> {
      if (!st) return new Map();
      return juntarCaixas([...st.remotos.values()].filter((r) => Date.now() - r.em < SEM_RESPOSTA_MS).map((r) => r.caixas));
    },
    parar() { if (st?.timer) clearInterval(st.timer); st = null; },
    /** Manda os papéis de um pedido feito sem internet para um computador da loja imprimir. true = algum computador aceitou. */
    async imprimir(id: string, tickets: TicketCelular[]): Promise<boolean> {
      if (!st || tickets.length === 0) return false;
      const pcs = [...st.pcs.values()].filter((p) => Date.now() - p.visto < SEM_RESPOSTA_MS).sort((a, b) => b.visto - a.visto);
      for (const pc of pcs) {
        try {
          const r = await http({ url: url(pc, '/imprimir'), method: 'POST', headers: cabecalho(), data: { id, tickets }, connectTimeout: 1200, readTimeout: 2000 });
          if (r.status === 200) return true;
        } catch { /* tenta o próximo */ }
      }
      return false;
    },
  };
}
