import { Category, CategoryGroup } from '@/types';

// Fix I2 da revisão final (2026-09-22): fonte única de ordenação pra todo
// item de "1º nível" (categoria solta OU grupo) nas 5 telas que navegam
// categoria hoje (barra do cliente, sheet do cliente, barra do garçom,
// modal do garçom, sidebar do lojista) — antes cada tela tinha sua própria
// cópia da mesma lógica de intercalar `categories.order`/`category_groups.order`,
// arriscando divergir silenciosamente entre elas.
//
// Regra: cada categoria solta ordena pelo próprio `order`. Cada grupo (só
// entra na lista se tiver >=1 categoria-membro na lista recebida) ordena
// pelo MENOR `order` entre seus membros — ou seja, o grupo aparece onde a
// primeira categoria dele apareceria se estivesse solta. Empate entre dois
// grupos: `group.order`. Empate entre uma categoria solta e um grupo (mesmo
// `order`): a categoria solta vem primeiro.
export type TopLevelItem =
  | { kind: 'category'; category: Category }
  | { kind: 'group'; group: CategoryGroup; categories: Category[] };

export function buildTopLevelItems(categories: Category[], groups: CategoryGroup[]): TopLevelItem[] {
  type Entry = { order: number; isCategory: boolean; groupOrder: number; item: TopLevelItem };

  const looseEntries: Entry[] = categories
    .filter(c => !c.group_id)
    .map(c => ({ order: c.order, isCategory: true, groupOrder: 0, item: { kind: 'category', category: c } }));

  const groupEntries: Entry[] = groups
    .map(g => {
      const members = categories.filter(c => c.group_id === g.id).sort((a, b) => a.order - b.order);
      if (members.length === 0) return null;
      const minOrder = Math.min(...members.map(c => c.order));
      const entry: Entry = { order: minOrder, isCategory: false, groupOrder: g.order, item: { kind: 'group', group: g, categories: members } };
      return entry;
    })
    .filter((e): e is Entry => e !== null);

  return [...looseEntries, ...groupEntries]
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      // Empate categoria-vs-grupo: categoria solta primeiro.
      if (a.isCategory !== b.isCategory) return a.isCategory ? -1 : 1;
      // Empate grupo-vs-grupo: desempata por group.order.
      if (!a.isCategory && !b.isCategory) return a.groupOrder - b.groupOrder;
      return 0;
    })
    .map(e => e.item);
}
