// Setor de impressão de um item: o do próprio produto; senão o da categoria (a pizza herda "Pizzaria").
export function setorDoItem(
  product: { sector_id?: string | null; category_id?: string | null; ignore_category_sector?: boolean } | undefined | null,
  catSetor: Record<string, string | null>,
): string | null {
  if (!product) return null;
  return product.sector_id || (product.ignore_category_sector ? null : (product.category_id ? catSetor[product.category_id] : null)) || null;
}
