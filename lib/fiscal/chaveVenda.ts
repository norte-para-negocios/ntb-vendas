// Chave da trava de emissão fiscal por VENDA (02/11/2026). Antes a trava do banco (167) usava o corpo da requisição
// ({tableId} ou {orderId}): o fechamento automático da mesa ({tableId}) e uma reemissão/reenvio pelo pedido
// ({orderId}) da MESMA venda pegavam travas diferentes e podiam emitir duas notas ao mesmo tempo. Agora a chave sai
// depois de resolver os pedidos: loja + pedido-âncora (o mais antigo da venda, o mesmo que vai em fiscal_notas.order_id)
// + pessoa (nota por pessoa não trava a nota de outra pessoa da mesma mesa). Sem dependência de Node: testável puro.

export interface PedidoDaVenda {
  id: string;
  created_at: string;
}

function instante(s: string): number {
  // Postgres devolve "2026-11-03 20:00:01.123456+00"; Date entende com "T" e fuso "+00:00".
  let t = Date.parse(s);
  if (Number.isNaN(t)) t = Date.parse(s.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Pedidos da venda em ordem estável: created_at e, no empate, id. O primeiro é a âncora. */
export function ordenarPedidosDaVenda<T extends PedidoDaVenda>(pedidos: T[]): T[] {
  return pedidos.slice().sort((x, y) => {
    const d = instante(x.created_at) - instante(y.created_at);
    if (d !== 0 && !Number.isNaN(d)) return d;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

export function chaveDaVendaResolvida(p: { storeId: string; pedidos: PedidoDaVenda[]; pessoa: string | null | undefined }): string | null {
  if (!p.storeId || !p.pedidos.length) return null;
  const ancora = ordenarPedidosDaVenda(p.pedidos)[0].id;
  return `venda|${p.storeId}|${ancora}|${p.pessoa?.trim() ?? ''}`;
}
