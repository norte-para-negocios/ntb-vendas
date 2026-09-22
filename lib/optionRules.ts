import type { ProductOptionGroup } from '@/types';
import { normalizeForSearch } from '@/lib/search';

// Regra do Sertão (Ramon, 2026-09-22): pizza no tamanho "Pequena" é só um
// sabor — o grupo "Sabor 2 (meio a meio)" some. Regra fixa por nome (não
// configurável): se renomearem "Tamanho"/"Pequena"/"Sabor 2", deixa de valer.
// Seleção feita no grupo escondido nunca entra no pedido (os chamadores
// calculam preço/itens só sobre os grupos visíveis).
export const visibleOptionGroups = (
  groups: ProductOptionGroup[],
  selections: Record<string, string[]>,
): ProductOptionGroup[] => {
  const pequenaSelecionada = groups.some(g =>
    normalizeForSearch(g.name).startsWith('tamanho') &&
    (selections[g.id] || []).some(id => {
      const opt = g.options.find(o => o.id === id);
      return !!opt && normalizeForSearch(opt.name).includes('pequena');
    })
  );
  if (!pequenaSelecionada) return groups;
  return groups.filter(g => !normalizeForSearch(g.name).startsWith('sabor 2'));
};
