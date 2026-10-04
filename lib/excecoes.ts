// Relatório de exceções + motivos de cancelamento (2026-10-04, migration 150).
export const DEFAULT_CANCEL_REASONS = [
  'Erro de lançamento',
  'Cliente desistiu',
  'Demora no preparo',
  'Item errado / veio errado',
  'Cortesia / ajuste do gerente',
  'Outro',
];

// A loja pode trocar a lista em stores.config.cancel_reasons; vazia ou ausente = padrão.
export const resolveCancelReasons = (config?: { cancel_reasons?: string[] } | null): string[] => {
  const custom = (config?.cancel_reasons ?? []).map((r) => r.trim()).filter(Boolean);
  return custom.length > 0 ? custom : DEFAULT_CANCEL_REASONS;
};

export const EXCEPTION_LABELS: Record<string, string> = {
  item_cancelado: 'Itens cancelados',
  taxa_editada: 'Taxa editada',
  taxa_removida: 'Taxa removida',
  pagamento_estornado: 'Pagamentos estornados',
  sangria_grande: 'Sangrias grandes',
  tolerancia_excedida: 'Diferença de caixa acima da tolerância',
  item_transferido: 'Itens transferidos de mesa',
  nota_cancelada: 'Notas canceladas',
};

export interface ExceptionOperatorRow {
  operator_name: string;
  counts: Record<string, number>;
  values: Record<string, number>;
}
export interface ExceptionEvent {
  operator_name: string;
  event_type: string;
  created_at: string;
  details: Record<string, unknown>;
}
export interface ExceptionsReport {
  by_operator: ExceptionOperatorRow[];
  events: ExceptionEvent[];
  notas_canceladas: { count: number; valor: number };
}

// Limite por operador no período. Acima dele a linha do operador fica em alerta.
export const DEFAULT_EXCEPTION_THRESHOLD = 10;

export const operatorTotalExceptions = (row: ExceptionOperatorRow): number =>
  Object.values(row.counts).reduce((s, n) => s + Number(n || 0), 0);

export const operatorsOverThreshold = (rows: ExceptionOperatorRow[], threshold: number): ExceptionOperatorRow[] =>
  rows.filter((r) => operatorTotalExceptions(r) >= threshold).sort((a, b) => operatorTotalExceptions(b) - operatorTotalExceptions(a));
