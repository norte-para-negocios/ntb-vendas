// Quem está logado agora (auditoria, 06/10/2026). Sem dependências: o cliente do Supabase importa daqui para mandar
// o cabeçalho X-NTB-Actor em toda requisição, e o banco grava esse ator em staff_audit_log (migration 163).
export type AtorAtual = { id: string | null; name: string; role: string };

let atual: AtorAtual | null = null;

export const definirAtor = (a: AtorAtual | null) => { atual = a; };
export const obterAtor = (): AtorAtual | null => atual;

// base64 do JSON em UTF-8 (nomes com acento). O banco decodifica em ntb_actor().
export function codificarAtor(a: AtorAtual): string {
  const json = JSON.stringify({ id: a.id, name: a.name, role: a.role });
  if (typeof Buffer !== 'undefined') return Buffer.from(json, 'utf8').toString('base64');
  return btoa(unescape(encodeURIComponent(json)));
}

export function cabecalhoAtor(): string | null {
  return atual ? codificarAtor(atual) : null;
}

// Tokens de sessão (migration 182). Guardados aqui (sem dependências) para lib/api.ts e as chamadas às rotas /api usarem os mesmos.
export const CHAVE_TOKEN_LOJA = 'ntb-sessao-token-loja';
export const CHAVE_TOKEN_ADMIN = 'ntb-sessao-token-admin';
const lerChave = (k: string): string | null => { try { return typeof window === 'undefined' ? null : window.localStorage.getItem(k); } catch { return null; } };

// `x-ntb-sessao` (Task 5): lojista e Master podem estar abertos no mesmo navegador, então vão os dois tokens, separados por
// vírgula; o servidor aceita se um deles vale para a loja (lib/server/exigirSessao.ts).
export function cabecalhoSessao(): Record<string, string> {
  const tokens = [lerChave(CHAVE_TOKEN_LOJA), lerChave(CHAVE_TOKEN_ADMIN)].filter((t): t is string => !!t);
  return tokens.length ? { 'x-ntb-sessao': tokens.join(',') } : {};
}

// Cabeçalhos para chamar as rotas de servidor (/api/*): o servidor repassa o ator ao banco (lib/supabaseAdmin.ts) e confere a sessão.
export function cabecalhosApi(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...cabecalhoSessao(), ...extra };
  const a = cabecalhoAtor();
  if (a) h['x-ntb-actor'] = a;
  return h;
}
