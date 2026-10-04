// lib/adminStatus.ts — frase curta de estado de cada área (cartão do celular e trilho do computador).
export type Tom = 'ok' | 'atencao' | 'erro' | 'neutro';
export interface Status { texto: string; tom: Tom }
export interface Prontidao { certificadoValido: boolean; cscHomologacao: boolean; cscProducao: boolean }

export const TOM_COR: Record<Tom, string> = { ok: 'var(--ok)', atencao: 'var(--warn)', erro: 'var(--err)', neutro: 'var(--text-muted)' };

const valido = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const qtd = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export const statusVendas = (contasHoje: number | null): Status | null =>
  !valido(contasHoje) ? null : contasHoje === 0 ? { texto: 'Sem vendas hoje', tom: 'neutro' } : { texto: `${qtd(contasHoje, 'conta', 'contas')} hoje`, tom: 'ok' };

export const statusCaixa = (abertos: number | null): Status | null =>
  !valido(abertos) ? null : abertos === 0 ? { texto: 'Nenhum caixa aberto', tom: 'neutro' } : { texto: qtd(abertos, 'caixa aberto', 'caixas abertos'), tom: 'ok' };

export const statusCardapio = (alertasAltos: number | null): Status | null =>
  !valido(alertasAltos) ? null : alertasAltos === 0 ? { texto: 'Cardápio em ordem', tom: 'ok' } : { texto: `${qtd(alertasAltos, 'alerta', 'alertas')} no cardápio`, tom: 'atencao' };

export const statusEquipe = (pessoas: number | null): Status | null =>
  !valido(pessoas) ? null : { texto: qtd(pessoas, 'pessoa', 'pessoas'), tom: 'neutro' };

export function statusConfig(impressoras: { is_active: boolean }[] | null, fiscal: Prontidao | null, ambiente: 'homologacao' | 'producao' | null): Status | null {
  if (!impressoras && !fiscal) return null;
  const partes: string[] = [];
  let tom: Tom = 'ok';
  if (impressoras) {
    const ativas = impressoras.filter((i) => i.is_active).length;
    if (impressoras.length === 0) { partes.push('Nenhuma impressora'); tom = 'atencao'; }
    else if (ativas === 0) { partes.push('Nenhuma impressora ativa'); tom = 'atencao'; }
    else partes.push(qtd(ativas, 'impressora ativa', 'impressoras ativas'));
  }
  if (fiscal && ambiente) {
    partes.push(ambiente === 'producao' ? 'Produção' : 'Homologação');
    if (!fiscal.certificadoValido || (ambiente === 'producao' && !fiscal.cscProducao) || (ambiente === 'homologacao' && !fiscal.cscHomologacao)) tom = 'erro';
    else if (ambiente === 'homologacao' && tom === 'ok') tom = 'atencao';
  }
  if (partes.length === 0) return null;
  return { texto: partes.join(' · '), tom };
}

// Contas fechadas hoje (dia local de Salvador). Mesma regra de conta de lib/reports/groupSales.ts:
// mesa/pedido + mesmo pagamento conta uma vez; cancelada não conta.
export function contarContasDeHoje(orders: { id: string; created_at: string; status: string; table_id?: string | null; payment_details?: unknown }[], agora: Date = new Date()): number {
  const dia = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Bahia' });
  const hoje = dia(agora);
  const vistas = new Set<string>();
  orders.forEach((o) => {
    if (o.status === 'canceled' || dia(new Date(o.created_at)) !== hoje) return;
    const metodos = (o.payment_details as { methods?: unknown } | null | undefined)?.methods ?? [];
    vistas.add(`${o.table_id ?? o.id}|${JSON.stringify(metodos)}`);
  });
  return vistas.size;
}
