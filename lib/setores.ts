// Setor de impressão de um item: o do próprio produto; senão o da categoria (a pizza herda "Pizzaria").
export function setorDoItem(
  product: { sector_id?: string | null; category_id?: string | null; ignore_category_sector?: boolean } | undefined | null,
  catSetor: Record<string, string | null>,
): string | null {
  if (!product) return null;
  return product.sector_id || (product.ignore_category_sector ? null : (product.category_id ? catSetor[product.category_id] : null)) || null;
}

// Local de estoque do Omie de onde a venda baixa (30/09, pedido do dono): escolhido em
// Impressão → Locais de preparo, um por destino. Chave: 'kitchen' | 'bar' | 'setor:<id>'.
export type MapaLocaisEstoque = Record<string, number>;

export function chaveDestinoEstoque(destino: 'kitchen' | 'bar' | { setorId: string }): string {
  return typeof destino === 'string' ? destino : `setor:${destino.setorId}`;
}

// Setor próprio do item (ex.: Pizzaria) > destino base (Cozinha/Bar) > null.
export function localEstoqueDoItem(
  mapa: MapaLocaisEstoque,
  setorId: string | null,
  destination: 'kitchen' | 'bar' | null,
): number | null {
  if (setorId && mapa[chaveDestinoEstoque({ setorId })]) return mapa[chaveDestinoEstoque({ setorId })];
  if (destination && mapa[destination]) return mapa[destination];
  return null;
}
