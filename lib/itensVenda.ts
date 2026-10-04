// Itens de uma venda para o Histórico, relatórios e impressão da conta: item CANCELADO nunca entra na contagem,
// no subtotal nem no total; quem mostra o item cancelado (riscado, com selo) usa `itensCancelados`.
type ItemLike = { quantity: number; price_at_time: number; status?: string };
type VendaLike<I extends ItemLike> = { order_items?: I[] | null };

export const itemCancelado = (i: { status?: string }): boolean => i.status === 'canceled';

export function itensAtivos<I extends ItemLike>(o: VendaLike<I>): I[] {
  return (o.order_items ?? []).filter((i) => !itemCancelado(i));
}

export function itensCancelados<I extends ItemLike>(o: VendaLike<I>): I[] {
  return (o.order_items ?? []).filter(itemCancelado);
}

export function qtdItensAtivos<I extends ItemLike>(o: VendaLike<I>): number {
  return itensAtivos(o).length;
}

export function subtotalItensAtivos<I extends ItemLike>(o: VendaLike<I>): number {
  return itensAtivos(o).reduce((s, i) => s + i.price_at_time * i.quantity, 0);
}

export const rotuloQtdItens = (n: number): string => `${n} ${n === 1 ? 'item' : 'itens'}`;
