import { supabaseUrlForConnectivityCheck, supabaseKeyForConnectivityCheck } from '../supabaseClient';

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
//
// Achado real e GRAVE (WhatsApp 2026-09-09, testado ao vivo no .exe
// empacotado de verdade via CDP, não só no navegador): o app desktop
// carrega o bundle por `app://bundle` (ver desktop/electron/main.js), não
// por `http(s)://` — um fetch daqui pra RAIZ do domínio de produção
// (`https://.../`) é bloqueado por CORS, porque uma página Next.js comum
// não manda `Access-Control-Allow-Origin` nenhum. Isso fazia
// `checkRealConnectivity()` SEMPRE devolver `false` no app real, mesmo
// com internet perfeita — ou seja, `runSync()` nunca rodava de verdade
// fora de um navegador comum (só ali o `app://` não existe e a origem já
// bate com o próprio domínio). Trocado pra bater no gateway do Supabase
// (`/rest/v1/`) em vez da raiz do site: PostgREST já responde com CORS
// liberado pra qualquer origem (é feito pra ser chamado de apps/domínios
// arbitrários) — confirmado ao vivo, mesmo fetch que falhava na raiz
// funciona normal aqui, de dentro do `app://bundle` real.
export async function checkRealConnectivity(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${supabaseUrlForConnectivityCheck}/rest/v1/`, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
      headers: { apikey: supabaseKeyForConnectivityCheck },
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
