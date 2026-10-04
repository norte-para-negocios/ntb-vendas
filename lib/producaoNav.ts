// lib/producaoNav.ts — item de menu "Produção" (abas por local) e contagem de pedidos por local.
import { chaveLocal, type LocalPreparo } from './locaisPreparo';

export interface ItemKds { status: string; sector_id?: string | null; order?: { order_type?: string } | null }

// Mesma regra que o badge de Cozinha/Bar já usava (useStoreNotifications): pedido de mesa pendente, ou balcão aceito.
export const itemPrecisaAcao = (i: ItemKds): boolean =>
  i.status === 'pending' || (i.order?.order_type === 'counter' && i.status === 'accepted');

// Setor apagado (sector_id some por `on delete set null`) ou desconhecido cai no local padrão da base.
export function contarPorLocal(
  porBase: { kitchen: ItemKds[]; bar: ItemKds[] },
  setoresConhecidos: Set<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  (['kitchen', 'bar'] as const).forEach((base) => {
    porBase[base].filter(itemPrecisaAcao).forEach((i) => {
      const chave = i.sector_id && setoresConhecidos.has(i.sector_id) ? chaveLocal(i.sector_id, base) : base;
      out[chave] = (out[chave] ?? 0) + 1;
    });
  });
  return out;
}

// "Produção" substitui Cozinha/Bar no menu só quando existe pelo menos um setor próprio.
// Loja sem setores (todas as de hoje) continua com os dois botões de sempre — zero mudança.
export const usaMenuProducao = (locais: LocalPreparo[]): boolean => locais.some((l) => l.setorId !== null);

// Acessível se o usuário/loja alcança Cozinha OU Bar (ids de aba de computeAccessibleTabIds).
export const producaoAcessivel = (acessiveis: Set<string>): boolean => acessiveis.has('kitchen') || acessiveis.has('bar');

// Locais que o usuário pode ver na Produção: a permissão da base (kitchen/bar) decide.
export function locaisAcessiveis(locais: LocalPreparo[], acessiveis: Set<string>): LocalPreparo[] {
  return locais.filter((l) => acessiveis.has(l.base));
}

export interface AbaProducao extends LocalPreparo { count: number }
export const abasProducao = (locais: LocalPreparo[], contagens: Record<string, number>): AbaProducao[] =>
  locais.map((l) => ({ ...l, count: contagens[l.chave] ?? 0 }));

export const somaContagens = (abas: { count: number }[]): number => abas.reduce((s, a) => s + a.count, 0);
