// lib/dadosAoVivo.ts — o que a tela aberta já buscou (mesas, itens do KDS), para o sino reaproveitar em vez de buscar de novo.
// As telas (Mesas, Caixa, Cozinha/Bar) já consultam a cada 5 s; o hook de avisos lê daqui quando o dado é recente
// e só vai à rede quando não há tela alimentando. Tudo em memória, por loja; nada persiste.
type Chave = string;
interface Entrada { em: number; dados: unknown }
const guardado = new Map<Chave, Entrada>();
const ouvintes = new Set<() => void>();

const chaveMesas = (loja: string): Chave => `mesas:${loja}`;
const chaveKds = (loja: string, base: string): Chave => `kds:${loja}:${base}`;

export function publicarMesas(loja: string, mesas: unknown[]): void { publicar(chaveMesas(loja), mesas); }
export function publicarKds(loja: string, base: string, itens: unknown[]): void { publicar(chaveKds(loja, base), itens); }

function publicar(chave: Chave, dados: unknown): void {
  guardado.set(chave, { em: Date.now(), dados });
  ouvintes.forEach((f) => { try { f(); } catch { /* ouvinte com defeito não derruba a tela */ } });
}

function recente<T>(chave: Chave, maxIdadeMs: number, agora: number): T | null {
  const e = guardado.get(chave);
  return e && agora - e.em <= maxIdadeMs ? (e.dados as T) : null;
}
export const mesasRecentes = <T,>(loja: string, maxIdadeMs: number, agora = Date.now()): T[] | null => recente<T[]>(chaveMesas(loja), maxIdadeMs, agora);
export const kdsRecente = <T,>(loja: string, base: string, maxIdadeMs: number, agora = Date.now()): T[] | null => recente<T[]>(chaveKds(loja, base), maxIdadeMs, agora);

/** Avisa quando uma tela publica dado novo. Devolve a função que cancela. */
export function aoPublicar(f: () => void): () => void { ouvintes.add(f); return () => { ouvintes.delete(f); }; }
export function limparDadosAoVivo(): void { guardado.clear(); ouvintes.clear(); }
