// Vendas de um período longo (25/10/2026). A RPC fetch_sales_history_secure corta em 2000 pedidos por chamada, o que
// já cortava um mês do Sertão sem avisar: aqui a busca é feita dia a dia (6 em paralelo), sem repetir pedido, e
// juntada por conta. Dia que veio com 2000 pedidos pode estar incompleto e é devolvido para avisar na tela.
import type { Order } from '@/types';
import { agruparPorConta } from '../faturamento';
import { diasDoPeriodo } from './periodo';
import { limitesDoDia } from './dia';

export const LIMITE_RPC_PEDIDOS = 2000;
const PARALELO = 6;

export async function carregarVendasPeriodo(
  buscarDia: (iniIso: string, fimIso: string) => Promise<Order[]>,
  de: string,
  ate: string,
): Promise<{ vendas: Order[]; diasCortados: string[] }> {
  const dias = diasDoPeriodo(de, ate);
  const porDia: Order[][] = new Array(dias.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < dias.length) {
      const i = proximo++;
      const [ini, fim] = limitesDoDia(dias[i]);
      porDia[i] = await buscarDia(ini.toISOString(), fim.toISOString());
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALELO, dias.length) }, trabalhador));
  const vistos = new Set<string>();
  const todos: Order[] = [];
  const diasCortados: string[] = [];
  porDia.forEach((lista, i) => {
    if ((lista?.length ?? 0) >= LIMITE_RPC_PEDIDOS) diasCortados.push(dias[i]);
    for (const o of lista ?? []) { if (!vistos.has(o.id)) { vistos.add(o.id); todos.push(o); } }
  });
  return { vendas: agruparPorConta(todos), diasCortados };
}
