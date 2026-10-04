// lib/pedidosDoDia.ts — lógica pura da janela "Pedidos do Dia" (sem React, sem I/O).
import { localDayAndMinutes } from './priceSchedule';

export interface LinhaPedido {
  id: string; orderId: string; time: string; tableNumber: number | string;
  productName: string; quantity: number; destination: 'kitchen' | 'bar'; localId: string;
  addons?: string; observation?: string; client?: string | null;
  closed: boolean; printed: boolean; addedByName?: string | null;
}
export type EstadoFiltro = 'todos' | 'impresso' | 'sem_registro';
export interface Filtros { local: string; estado: EstadoFiltro; busca: string; soMeus: boolean; meuNome: string }
export const FILTROS_PADRAO: Filtros = { local: 'todos', estado: 'todos', busca: '', soMeus: false, meuNome: '' };

const TZ = 'America/Bahia';
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const horaCurta = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export function buscaCombina(l: LinhaPedido, busca: string): boolean {
  const q = norm(busca);
  if (!q) return true;
  const alvo = [`mesa ${l.tableNumber}`, l.productName, l.addons, l.observation, l.client, l.addedByName]
    .filter(Boolean).map((x) => norm(String(x))).join(' | ');
  return q.split(/\s+/).every((p) => alvo.includes(p));
}

export function filtrarLinhas(rows: LinhaPedido[], f: Filtros, ignorarLocal = false): LinhaPedido[] {
  return rows.filter((l) =>
    (ignorarLocal || f.local === 'todos' || l.localId === f.local)
    && (!f.soMeus || (!!l.addedByName && l.addedByName === f.meuNome))
    && (f.estado === 'todos' || (f.estado === 'impresso') === l.printed)
    && buscaCombina(l, f.busca));
}

export function contarPorLocal(rows: LinhaPedido[], f: Filtros): Record<string, number> {
  const base = filtrarLinhas(rows, f, true);
  const out: Record<string, number> = { todos: base.length };
  base.forEach((l) => { out[l.localId] = (out[l.localId] ?? 0) + 1; });
  return out;
}

export function resumir(rows: LinhaPedido[]) {
  const semRegistro = rows.filter((l) => !l.printed);
  return {
    linhas: rows.length,
    unidades: rows.reduce((s, l) => s + l.quantity, 0),
    impressos: rows.length - semRegistro.length,
    semRegistro: semRegistro.length,
    semRegistroAbertas: semRegistro.filter((l) => !l.closed).length, // só estas podem ser reimpressas / exigem atenção
    mesas: new Set(rows.map((l) => String(l.tableNumber))).size,
  };
}

export interface GrupoPedidos {
  chave: string; titulo: string; linhas: LinhaPedido[]; unidades: number;
  semRegistro: number; semRegistroAbertas: number; ultimaHora: string; fechada: boolean;
}

const montarGrupo = (chave: string, titulo: string, linhas: LinhaPedido[]): GrupoPedidos => {
  const r = resumir(linhas);
  return {
    chave, titulo, linhas, unidades: r.unidades, semRegistro: r.semRegistro, semRegistroAbertas: r.semRegistroAbertas,
    ultimaHora: linhas.reduce((m, l) => (l.time > m ? l.time : m), linhas[0].time),
    fechada: linhas.every((l) => l.closed),
  };
};
const porUltimaHoraDesc = (a: GrupoPedidos, b: GrupoPedidos) => new Date(b.ultimaHora).getTime() - new Date(a.ultimaHora).getTime();
const agrupar = (rows: LinhaPedido[], chaveDe: (l: LinhaPedido) => string): Map<string, LinhaPedido[]> => {
  const m = new Map<string, LinhaPedido[]>();
  rows.forEach((l) => m.set(chaveDe(l), [...(m.get(chaveDe(l)) ?? []), l]));
  return m;
};

/** Um grupo por mesa; grupo mais recente primeiro; dentro dele, na ordem em que foi lançado (como uma comanda). */
export function agruparPorMesa(rows: LinhaPedido[]): GrupoPedidos[] {
  return Array.from(agrupar(rows, (l) => String(l.tableNumber)).entries())
    .map(([chave, ls]) => montarGrupo(chave, `Mesa ${chave}`, [...ls].sort((a, b) => a.time.localeCompare(b.time))))
    .sort(porUltimaHoraDesc);
}

/** Um grupo por hora cheia (fuso Bahia); mais recente primeiro; dentro dele, o item mais novo no topo. */
export function agruparPorHora(rows: LinhaPedido[]): GrupoPedidos[] {
  const hora = (l: LinhaPedido) => String(Math.floor(localDayAndMinutes(new Date(l.time), TZ).minutes / 60)).padStart(2, '0');
  return Array.from(agrupar(rows, hora).entries())
    .map(([chave, ls]) => montarGrupo(chave, `${chave}h`, [...ls].sort((a, b) => b.time.localeCompare(a.time))))
    .sort(porUltimaHoraDesc);
}
