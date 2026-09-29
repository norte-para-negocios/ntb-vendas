// Categoria marcada `staff_only` (ex.: Embalagens) existe pro garçom/caixa lançarem, mas o cliente do QR não vê.
export function removerCategoriasSoEquipe<C extends { id: string; staff_only?: boolean | null }, P extends { category_id?: string | null }>(
  categories: C[],
  products: P[],
): { categories: C[]; products: P[] } {
  const escondidas = new Set(categories.filter((c) => c.staff_only).map((c) => c.id));
  return {
    categories: categories.filter((c) => !c.staff_only),
    products: products.filter((p) => !(p.category_id && escondidas.has(p.category_id))),
  };
}
