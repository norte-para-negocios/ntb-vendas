// Rascunho do carrinho da mesa (garçom): sobrevive a fechar a janela, trocar de mesa ou o app recarregar.
export const RASCUNHO_VALIDADE_MS = 12 * 60 * 60 * 1000;
export const chaveRascunho = (storeId: string, tableId: string) => `ntb-rascunho-mesa:${storeId}:${tableId}`;

type Linha = { key: string; product: { id: string }; qty: number; notes: string; selectedOptions: any[] };

export function serializarRascunho(storeId: string, tableId: string, linhas: Linha[], agora = Date.now()): string {
  return JSON.stringify({ v: 1, storeId, tableId, savedAt: agora, linhas });
}

// Só devolve linhas cujo produto ainda existe no cardápio atual (casa por product.id) e troca o produto pelo atual
// (preço novo). Outra loja, outra mesa, rascunho velho ou JSON ruim = [].
export function restaurarRascunho<P extends { id: string }>(raw: string | null, storeId: string, tableId: string, cardapio: P[], agora = Date.now()): (Linha & { product: P })[] {
  if (!raw) return [];
  try {
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || d.storeId !== storeId || d.tableId !== tableId || !Array.isArray(d.linhas)) return [];
    if (agora - Number(d.savedAt) > RASCUNHO_VALIDADE_MS) return [];
    const porId = new Map(cardapio.map((p) => [p.id, p]));
    const out: (Linha & { product: P })[] = [];
    for (const l of d.linhas) {
      const atual = l?.product?.id ? porId.get(l.product.id) : undefined;
      if (!atual || !(Number(l.qty) >= 1)) continue;
      out.push({ key: String(l.key), product: atual, qty: Number(l.qty), notes: String(l.notes ?? ''), selectedOptions: Array.isArray(l.selectedOptions) ? l.selectedOptions : [] });
    }
    return out;
  } catch { return []; }
}
