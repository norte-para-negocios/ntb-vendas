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

// Cabeçalhos para chamar as rotas de servidor (/api/*): o servidor repassa o ator ao banco (lib/supabaseAdmin.ts).
export function cabecalhosApi(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  const a = cabecalhoAtor();
  if (a) h['x-ntb-actor'] = a;
  return h;
}
