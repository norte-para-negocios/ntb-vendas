import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://giiwtnddasminjxweohr.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_7iLDkCZ5Fp3KQWW0aQer2w_eN84SfST';

// Sem isto, Wi-Fi conectado sem internet deixa cada chamada REST/RPC pendurada
// até o timeout do navegador (dezenas de segundos) antes de cair no cache
// offline — o app parece travado. Aqui: offline conhecido falha na hora, e
// leituras REST/RPC ganham teto de 8s. O erro vira TypeError/AbortError, que
// `isNetworkError` já trata como rede e aciona o fallback de cache/fila.
const REST_TIMEOUT_MS = 8000;
const fetchComFalhaRapida: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.reject(new TypeError('Failed to fetch (offline)'));
  }
  // Offline já detectado pelo ping de conectividade (lib/offline/network.ts):
  // falha na hora, sem esperar o timeout do navegador (Wi-Fi sem internet).
  const off = (globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt;
  if (off && Date.now() - off < 15000 && url.includes('/rest/v1/') && !url.endsWith('/rest/v1/')) {
    return Promise.reject(new TypeError('Failed to fetch (offline detectado)'));
  }
  // Só leituras (GET/HEAD e RPCs fetch_*): abortar uma escrita que já chegou
  // no servidor faria a fila offline reenviar e duplicar o pedido.
  const method = (init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
  const ehLeitura = method === 'GET' || method === 'HEAD' || url.includes('/rest/v1/rpc/fetch_');
  if (!url.includes('/rest/v1/') || !ehLeitura) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
  init?.signal?.addEventListener('abort', () => controller.abort());
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient(supabaseUrl, supabaseKey, { global: { fetch: fetchComFalhaRapida } });

// Exportados pra `lib/offline/network.ts` montar o próprio ping de
// conectividade contra o gateway do Supabase (que já responde com CORS
// liberado pra qualquer origem, ao contrário da raiz do site) — nunca
// hardcodar essa URL/key de novo em outro arquivo.
export const supabaseUrlForConnectivityCheck = supabaseUrl;
export const supabaseKeyForConnectivityCheck = supabaseKey;

export const isSupabaseConfigured = () =>
  supabaseUrl !== '' && supabaseKey !== '';
