// lib/modoEstoque.ts — como a loja controla estoque (migration 168, stores.stock_mode). Puro, sem I/O.
//   omie    = baixa via Norte Estoque -> Omie (como sempre foi; Sertão e lojas atuais)
//   proprio = baixa no estoque próprio do Norte Estoque, sem Omie
//   nenhum  = só venda e nota fiscal, sem baixa de estoque
export type ModoEstoque = 'omie' | 'proprio' | 'nenhum';

export const MODOS_ESTOQUE: ModoEstoque[] = ['omie', 'proprio', 'nenhum'];

/** Valor desconhecido, vazio ou de banco antigo (sem a coluna) = 'omie': nunca muda o comportamento de hoje. */
export function normalizarModo(valor: unknown): ModoEstoque {
  return valor === 'proprio' || valor === 'nenhum' ? valor : 'omie';
}

export const modoDaLoja = (loja?: { stock_mode?: unknown } | null): ModoEstoque => normalizarModo(loja?.stock_mode);

export const ehProprio = (m: unknown) => normalizarModo(m) === 'proprio';
export const ehOmie = (m: unknown) => normalizarModo(m) === 'omie';
/** A loja baixa estoque nas vendas (Omie ou próprio). 'nenhum' não baixa, não cria baixa e não mostra alerta de código. */
export const usaEstoque = (m: unknown) => normalizarModo(m) !== 'nenhum';

/** Nome do sistema de estoque para os textos da tela: lojas fora do Omie nunca veem a palavra "Omie". */
export const nomeSistemaEstoque = (m: unknown) => (ehOmie(m) ? 'Omie' : 'Estoque');

/** "código do Omie" / "código do estoque": rótulo único para o código que liga o produto ao estoque. */
export const rotuloCodigo = (m: unknown) => (ehOmie(m) ? 'Código Omie' : 'Código do estoque');
export const rotuloCodigoCurto = (m: unknown) => (ehOmie(m) ? 'Cód. Omie' : 'Cód. estoque');

export const ROTULO_MODO: Record<ModoEstoque, { titulo: string; descricao: string }> = {
  omie: { titulo: 'Com Omie', descricao: 'O estoque fica no Omie. O Norte Estoque espelha e escreve no Omie (como hoje).' },
  proprio: { titulo: 'Estoque próprio', descricao: 'O estoque fica no Norte Estoque, sem Omie: produtos, locais, saldos, entradas, transferências e inventário.' },
  nenhum: { titulo: 'Sem estoque', descricao: 'Só venda e nota fiscal. Nenhuma venda baixa estoque.' },
};

/**
 * Campos de `stock_mode` para um insert/update de `stores`. Só devolve algo quando o modo NÃO é 'omie': loja Omie continua
 * gravando exatamente o mesmo corpo de antes (e um banco sem a migration 168 segue funcionando para elas).
 */
export function stockModeFields(valor: unknown): { stock_mode?: ModoEstoque } {
  const m = normalizarModo(valor);
  return m === 'omie' ? {} : { stock_mode: m };
}
