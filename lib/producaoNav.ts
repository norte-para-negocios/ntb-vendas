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

// Regra do dono (04/10): "todos os locais são iguais". Com 2 ou mais abas de KDS (Cozinha se kitchen_kds ligado, Bar se bar_kds
// ligado, e todo local criado — mesmo com 0 categorias) o menu vira UM item "Produção" com abas. Com 1 aba só, vira um item com o nome dela.
// Passe aqui os locais JÁ filtrados por permissão (locaisAcessiveis).
export const usaMenuProducao = (locais: LocalPreparo[]): boolean => locais.length >= 2;

export type ModoProducao =
  | { tipo: 'nenhum' }
  | { tipo: 'abas' }
  | { tipo: 'unico'; tabId: 'kitchen' | 'bar' | 'producao'; nome: string };

export function modoProducao(locais: LocalPreparo[]): ModoProducao {
  if (locais.length === 0) return { tipo: 'nenhum' };
  if (locais.length >= 2) return { tipo: 'abas' };
  const l = locais[0];
  // Cozinha/Bar sozinhos mantêm as abas históricas (permissão e módulo por id); local criado sozinho usa 'producao' com o nome dele.
  return { tipo: 'unico', tabId: l.setorId ? 'producao' : l.base, nome: l.nome };
}

// Se a aba aberta deixou de existir (loja ganhou/perdeu locais), devolve a aba equivalente; null = nada a fazer.
export function abaCorretaDeProducao(modo: ModoProducao, abaAtual: string): string | null {
  if (modo.tipo === 'nenhum') return null;
  const ehProducao = abaAtual === 'kitchen' || abaAtual === 'bar' || abaAtual === 'producao';
  if (!ehProducao) return null;
  const alvo = modo.tipo === 'abas' ? 'producao' : modo.tabId;
  return abaAtual === alvo ? null : alvo;
}

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

// Contadores do cabeçalho da Produção: novos (pendente/aceito), preparando, prontos e atrasados.
export function resumirKds<T extends { status: string }>(itens: T[], atrasado: (i: T) => boolean): { novos: number; preparando: number; prontos: number; atrasados: number } {
  const r = { novos: 0, preparando: 0, prontos: 0, atrasados: 0 };
  itens.forEach((i) => {
    if (i.status === 'pending' || i.status === 'accepted') r.novos++;
    else if (i.status === 'preparing') r.preparando++;
    else if (i.status === 'ready') r.prontos++;
    if (atrasado(i)) r.atrasados++;
  });
  return r;
}
