// Regra pura da sessão nas rotas /api (Task 5, migration 182/191). Sem dependências: testada em scripts/testes/exigirSessao.test.ts.
// O app manda o(s) token(s) de sessão em `x-ntb-sessao` (lojista e Master podem estar abertos no mesmo navegador: vão os dois,
// separados por vírgula). Basta um deles valer para a loja alvo.

export type SessaoRow = { tipo: string; store_id: string | null; expira_em: string };

const TOKEN_RE = /^[a-f0-9]{32,128}$/i;

/** Tokens do cabeçalho `x-ntb-sessao`: só hex do tamanho de token, sem repetir, no máximo 3. */
export function lerTokens(cabecalho: string | null | undefined): string[] {
  if (!cabecalho) return [];
  const out: string[] = [];
  for (const parte of cabecalho.split(',')) {
    const t = parte.trim();
    if (TOKEN_RE.test(t) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 3);
}

/** true se alguma sessão (não vencida) vale para a loja: Master/universal em qualquer loja; lojista só na própria. */
export function sessaoValePara(sessoes: SessaoRow[], storeId: string | null, agora: Date = new Date()): boolean {
  return sessoes.some((s) => {
    if (!(new Date(s.expira_em).getTime() > agora.getTime())) return false;
    if (s.tipo === 'admin' || s.tipo === 'universal') return true;
    return s.tipo === 'loja' && !!storeId && s.store_id === storeId;
  });
}
