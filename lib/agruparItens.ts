// Itens iguais da comanda numa linha só (24/10/2026, ODARA: "quando tem dois pedidos iguais na mesma mesa ficam juntos
// com uma setinha para separar; aí dá para cancelar só um"). Igual = mesmo produto, mesmas opções, mesma observação e
// mesmo preço. Cada lançamento continua existindo (cancelar e mover agem em um lançamento); o grupo só soma.
export interface ItemAgrupavel {
  id: string;
  product_id?: string | null;
  quantity: number;
  price_at_time: number;
  notes?: string | null;
  created_at?: string;
  selected_options?: { name?: string }[] | null;
}

export interface GrupoDeItens<T extends ItemAgrupavel> {
  chave: string;
  itens: T[];
  quantidade: number;
  total: number;
  ultimo?: string;
}

const observacao = (notes?: string | null) => (notes || '').replace(/^(\[[^\]]*\]\s*)+/, '').trim().toLowerCase();

export function chaveDoItem(i: ItemAgrupavel): string {
  const opcoes = (i.selected_options || []).map((o) => o?.name || '').sort().join('|');
  return [i.product_id || i.id, opcoes, observacao(i.notes), Number(i.price_at_time).toFixed(2)].join('§');
}

export function agruparItensIguais<T extends ItemAgrupavel>(itens: T[]): GrupoDeItens<T>[] {
  const mapa = new Map<string, GrupoDeItens<T>>();
  for (const i of itens) {
    const chave = chaveDoItem(i);
    let g = mapa.get(chave);
    if (!g) { g = { chave, itens: [], quantidade: 0, total: 0 }; mapa.set(chave, g); }
    g.itens.push(i);
    g.quantidade += Number(i.quantity) || 0;
    g.total += (Number(i.price_at_time) || 0) * (Number(i.quantity) || 0);
    if (i.created_at && (!g.ultimo || i.created_at > g.ultimo)) g.ultimo = i.created_at;
  }
  return [...mapa.values()];
}
