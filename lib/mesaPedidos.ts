// Pedidos da mesa em lista curta (visão rápida do modal da mesa). Lógica pura, testada em scripts/testes/mesaPedidos.test.ts.
export interface OrderItemLike {
  id: string; quantity: number; price_at_time: number; status: string; added_by_name?: string | null;
  product?: { name?: string; fee_type?: string | null } | null; selected_options?: { name: string }[] | null;
}
export interface LinhaPedido { id: string; nome: string; qtd: number; valor: number; status: string; quem: string | null; taxa: boolean }

export function resumirPedidosDaMesa(items: OrderItemLike[]): { linhas: LinhaPedido[]; total: number } {
  let cents = 0;
  const linhas = items.map((i) => {
    const opcoes = (i.selected_options ?? []).map((o) => o.name).filter(Boolean).join(', ');
    const base = i.product?.name ?? 'Produto indisponível';
    const valor = Math.round(Number(i.price_at_time) * i.quantity * 100) / 100;
    if (i.status !== 'canceled') cents += Math.round(valor * 100);
    return { id: i.id, nome: opcoes ? `${base} · ${opcoes}` : base, qtd: i.quantity, valor, status: i.status, quem: i.added_by_name ?? null, taxa: !!i.product?.fee_type };
  });
  return { linhas, total: cents / 100 };
}
