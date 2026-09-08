// Global Constraint do plano: `navigator.onLine` sozinho NUNCA decide se
// uma ação é offline — só decide se vale tentar a chamada de rede
// primeiro. Um erro de RESPOSTA da RPC (ex. {success:false} de negócio,
// ou um erro Postgres real tipo violação de constraint) nunca deve ser
// classificado como erro de rede, senão a fila "engoliria" erros de
// validação de verdade.
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return true;
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) return true;
  // supabase-js (PostgrestError) e o client do Supabase Realtime lançam
  // erros com `message` contendo "Failed to fetch"/"NetworkError" quando
  // a causa real é rede, mesmo não sendo um TypeError nativo — checagem
  // por mensagem como fallback, não como caminho principal.
  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    return /failed to fetch|network ?error|err_internet_disconnected|err_name_not_resolved/i.test((error as any).message);
  }
  return false;
}

// `navigator.onLine` fica `true` em Wi-Fi conectado sem internet de
// verdade (ex. portal cativo, roteador sem link externo) — não confiável
// sozinho (ver comentário da função acima). Esta função faz uma chamada
// real, leve, contra o próprio servidor de produção pra confirmar.
export async function checkRealConnectivity(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    // HEAD na raiz do domínio de produção — não precisa de autenticação,
    // só confirma que o servidor responde. Mesmo domínio já usado por
    // resolverUrlApi() (ver lib/api.ts).
    const res = await fetch('https://testvendase.norteparanegocios.com.br/', {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}
