// Tempo livre de cancelamento (migration 183, reunião 21/10/2026): com stores.config.cancel_free_minutes = N > 0, item
// lançado há menos de N minutos cancela sem senha; depois, só com a senha de quem autoriza. 0/ausente = sempre senha.
// Mesma regra do servidor (cancelar_itens_v3); aqui só decide se a tela pede a senha.

export const MAX_MINUTOS_LIVRES = 60;

export function minutosLivres(config: Record<string, unknown> | null | undefined): number {
  const v = Number((config ?? {}).cancel_free_minutes);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(MAX_MINUTOS_LIVRES, Math.floor(v));
}

// Margem de 15 s para o relógio do aparelho: na dúvida a tela pede a senha (o servidor decide de verdade).
export function dentroDoTempoLivre(
  itens: { created_at?: string | null }[],
  config: Record<string, unknown> | null | undefined,
  agora: number = Date.now(),
): boolean {
  const min = minutosLivres(config);
  if (min === 0 || itens.length === 0) return false;
  return itens.every((i) => {
    const t = i.created_at ? Date.parse(i.created_at) : NaN;
    return Number.isFinite(t) && agora - t < min * 60_000 - 15_000;
  });
}

// Quantidade a cancelar: entre 1 e o total do item.
export function limitarQuantidade(qtd: number, total: number): number {
  if (!Number.isFinite(qtd)) return total;
  return Math.max(1, Math.min(total, Math.floor(qtd)));
}
