// Mais e menos vendidos do Resumo (StoreDashboardView), com filtro por grupo ou categoria (Andrey, 20/10/2026).
// Mesmas regras de antes: item cancelado e taxa (serviço, rolha...) não são produto vendido; "Pizza (Catupiry)" e
// "Pizza (Mussarela)" são linhas separadas; menos vendidos não repete quem já está nos mais vendidos.
import { getOrderItemDisplayName } from './labels';

export type FiltroCategoria = { tipo: 'todas' } | { tipo: 'grupo'; id: string } | { tipo: 'categoria'; id: string };
export type LinhaRanking = { key: string; name: string; qty: number };

type ItemLike = { product_id?: string | null; product?: { name: string; category_id?: string | null; fee_type?: string | null } | null; status?: string; quantity: number; selected_options?: { name: string }[] | null };
type VendaLike = { order_items?: ItemLike[] | null };
type CategoriaLike = { id: string; name: string; order: number; group_id?: string | null };
type GrupoLike = { id: string; name: string; order: number };

const assinatura = (opts?: { name: string }[] | null) => (opts || []).map((o) => o.name).slice().sort().join('|');

export function rankingDeProdutos(vendas: VendaLike[], categorias: CategoriaLike[], filtro: FiltroCategoria): { top: LinhaRanking[]; bottom: LinhaRanking[] } {
  const doGrupo = filtro.tipo === 'grupo' ? new Set(categorias.filter((c) => c.group_id === filtro.id).map((c) => c.id)) : null;
  const entra = (categoryId: string | null | undefined) => {
    if (filtro.tipo === 'todas') return true;
    if (!categoryId) return false;
    return filtro.tipo === 'categoria' ? categoryId === filtro.id : doGrupo!.has(categoryId);
  };
  const mapa = new Map<string, LinhaRanking>();
  for (const v of vendas) for (const i of v.order_items || []) {
    if (!i.product || i.status === 'canceled' || i.product.fee_type) continue;
    if (!entra(i.product.category_id)) continue;
    const key = `${i.product_id}::${assinatura(i.selected_options)}`;
    const linha = mapa.get(key) || { key, name: getOrderItemDisplayName(i), qty: 0 };
    linha.qty += i.quantity;
    mapa.set(key, linha);
  }
  const arr = [...mapa.values()].sort((a, b) => b.qty - a.qty);
  const top = arr.slice(0, 5);
  const noTop = new Set(top.map((p) => p.key));
  const bottom = arr.slice().reverse().filter((p) => !noTop.has(p.key)).slice(0, 5);
  return { top, bottom };
}

/** Opções do seletor: Todas, cada grupo (com as suas categorias logo abaixo) e as categorias soltas, na ordem do cardápio. */
export function opcoesDoFiltro(categorias: CategoriaLike[], grupos: GrupoLike[]): { value: string; label: string }[] {
  const porOrdem = <T extends { order: number }>(l: T[]) => l.slice().sort((a, b) => a.order - b.order);
  const ids = new Set(grupos.map((g) => g.id));
  const out = [{ value: 'todas', label: 'Todas as categorias' }];
  for (const g of porOrdem(grupos)) {
    const dele = porOrdem(categorias.filter((c) => c.group_id === g.id));
    if (dele.length === 0) continue;
    out.push({ value: `g:${g.id}`, label: `${g.name} (todas)` });
    for (const c of dele) out.push({ value: `c:${c.id}`, label: `— ${c.name}` });
  }
  for (const c of porOrdem(categorias.filter((c) => !c.group_id || !ids.has(c.group_id)))) out.push({ value: `c:${c.id}`, label: c.name });
  return out;
}

export function filtroDoValor(v: string): FiltroCategoria {
  if (v.startsWith('g:') && v.length > 2) return { tipo: 'grupo', id: v.slice(2) };
  if (v.startsWith('c:') && v.length > 2) return { tipo: 'categoria', id: v.slice(2) };
  return { tipo: 'todas' };
}
