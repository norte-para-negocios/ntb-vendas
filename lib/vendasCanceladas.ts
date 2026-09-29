// Regras de exibição da aba "Canceladas" do Histórico de vendas (fetch_canceled_sales_secure).

export type NotaCancelada = { numero: number | null; serie: number | null; modelo: string | null; cancelada_em: string | null; justificativa: string | null };

export type PedidoCancelado = {
  id: string;
  order_type: 'table' | 'counter' | string;
  customer_name: string | null;
  created_at: string;
  updated_at: string;
  total: number | null;
  pagamento: { total?: number; methods?: { method: string; amount: number }[]; operador_nome?: string } | null;
  estornado_por_nota: boolean;
  mesa: number | null;
  itens: { quantity: number; price_at_time: number; product_name: string | null }[];
  notas: NotaCancelada[];
};

export type ItemCancelado = { id: string; quantity: number; price_at_time: number; created_at: string; product_name: string | null; order_type: string; mesa: number | null };

export type VendasCanceladas = { pedidos: PedidoCancelado[]; itens: ItemCancelado[] };

// O que foi cobrado (com taxa de serviço) quando havia pagamento; senão o total do pedido.
export const valorCancelado = (p: PedidoCancelado): number => {
  const pago = Number(p.pagamento?.total);
  if (Number.isFinite(pago) && pago > 0) return pago;
  const total = Number(p.total);
  return Number.isFinite(total) ? total : 0;
};

export const motivoCancelamento = (p: PedidoCancelado): string => {
  if (!p.estornado_por_nota) return 'Pedido cancelado';
  const nums = (p.notas ?? []).map((n) => n.numero).filter((n): n is number => typeof n === 'number');
  if (nums.length === 0) return 'Nota fiscal cancelada';
  return `Nota fiscal cancelada (nº ${nums.length === 1 ? nums[0] : `${nums.slice(0, -1).join(', ')} e ${nums[nums.length - 1]}`})`;
};

export const resumoCanceladas = (pedidos: PedidoCancelado[]): { quantidade: number; valorTotal: number } => ({
  quantidade: pedidos.length,
  valorTotal: pedidos.reduce((acc, p) => acc + valorCancelado(p), 0),
});
