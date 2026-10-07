// Conta aguardando pagamento (migration 172): quando a mesa é liberada para novos clientes, a conta que ainda não foi paga
// vira uma linha própria de `tables` (standby = true, standby_de = a mesa física). get_tables_secure devolve as duas coisas;
// aqui elas são separadas para o mapa (só mesas físicas) e a lista "Aguardando pagamento".
import type { Table } from '../types';

export const ehContaAguardando = (t: Pick<Table, 'standby'>): boolean => t.standby === true;

export function separarContasAguardando<T extends Pick<Table, 'standby' | 'status'>>(lista: T[]): { mesas: T[]; contas: T[] } {
  const mesas: T[] = [];
  const contas: T[] = [];
  for (const t of lista) {
    if (!ehContaAguardando(t)) mesas.push(t);
    else if (t.status === 'standby') contas.push(t);
  }
  return { mesas, contas };
}

/** Contas aguardando de uma mesa física, da mais antiga para a mais nova. */
export function contasDaMesa<T extends Pick<Table, 'standby_de' | 'standby_em'>>(contas: T[], mesaId: string): T[] {
  return contas
    .filter((c) => c.standby_de === mesaId)
    .sort((a, b) => String(a.standby_em ?? '').localeCompare(String(b.standby_em ?? '')));
}

/** Para jurisdição de garçom: a conta aguardando pertence à área da mesa de onde saiu. */
export const idDaMesaFisica = (t: Pick<Table, 'id' | 'standby' | 'standby_de'>): string =>
  t.standby && t.standby_de ? t.standby_de : t.id;

/** Liberar a mesa só faz sentido com a mesa aberta e com conta para receber. */
export const podeLiberarMesa = (t: Pick<Table, 'status' | 'standby'>, temItens: boolean): boolean =>
  !t.standby && (t.status === 'occupied' || t.status === 'waiting_bill') && temItens;
