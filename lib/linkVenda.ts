// Link direto para uma venda no painel do lojista: /loja?venda=<id do pedido>. Usado pelo Norte Estoque
// ("Abrir documento" de um movimento de VENDA). Abre Administração > Vendas > Histórico com o detalhe da venda.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id do pedido pedido pelo link, ou null (ausente/inválido). */
export function vendaDoLink(search: string | null | undefined): string | null {
  if (!search) return null;
  const v = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('venda');
  return v && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;
}

/** Lido no navegador (nunca no servidor). */
export function vendaDoLinkAtual(): string | null {
  if (typeof window === 'undefined') return null;
  return vendaDoLink(window.location.search);
}

/** Tira o parâmetro da barra de endereço depois de abrir a venda (F5 não reabre). */
export function limparLinkVenda(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('venda')) return;
  url.searchParams.delete('venda');
  window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
}
