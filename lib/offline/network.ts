import { supabaseUrlForConnectivityCheck, supabaseKeyForConnectivityCheck, OFFLINE_FLAG_MS } from '../supabaseClient';

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
    return /failed to fetch|network ?error|err_internet_disconnected|err_name_not_resolved|aborterror|operation was aborted|signal is aborted/i.test((error as any).message);
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
let ultimoOkAt = 0;
// Uma tentativa do ping. Qualquer resposta HTTP (até 5xx do gateway) prova que a rede chegou ao servidor.
async function pingUmaVez(timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${supabaseUrlForConnectivityCheck}/rest/v1/`, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
      headers: { apikey: supabaseKeyForConnectivityCheck },
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkRealConnectivity(): Promise<boolean> {
  // Resultado recente vale por alguns segundos: evita pagar o ping (ou o timeout sem internet) a cada toque do garçom.
  const off = (globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt;
  if (off && Date.now() - off < OFFLINE_FLAG_MS) return false;
  if (Date.now() - ultimoOkAt < 3000) return true;
  // Duas tentativas antes de declarar offline: um engasgo isolado do Wi-Fi do salão não pode derrubar o app.
  const ok = (await pingUmaVez(2500)) || (await pingUmaVez(2500));
  if (ok) { delete (globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt; ultimoOkAt = Date.now(); }
  else (globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt = Date.now();
  return ok;
}

// Vigia da conexão (08/10/2026, "sem internet o app fica muito lento"): enquanto está sem internet, pinga a cada 3 s.
// Mantém o aviso "sem internet" vivo (as leituras falham na hora e o app usa o aparelho) e percebe a volta em
// segundos, chamando `aoVoltar` (sincroniza a fila). Com internet não faz nada (as próprias requisições detectam a queda).
let vigiando = false;
export function vigiarConexao(aoVoltar: () => void): void {
  if (vigiando || typeof window === 'undefined') return;
  vigiando = true;
  let ticks = 0;
  setInterval(async () => {
    const g = globalThis as { __ntbOfflineAt?: number };
    ticks++;
    // Com internet: confere a cada ~9 s, para perceber a queda ANTES de o garçom tocar em algo (senão a 1ª tela
    // depois da queda ainda esperava o tempo-limite). Sem internet: a cada 3 s, para perceber a volta.
    if (!g.__ntbOfflineAt && ticks % 2 !== 0) return;
    if (!g.__ntbOfflineAt && Date.now() - ultimoOkAt < 8000) return;
    if (await pingUmaVez(2500)) {
      const voltou = !!g.__ntbOfflineAt;
      delete g.__ntbOfflineAt; ultimoOkAt = Date.now();
      if (voltou) aoVoltar();
    } else g.__ntbOfflineAt = Date.now();
  }, 3000);
}
