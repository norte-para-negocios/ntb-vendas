import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://giiwtnddasminjxweohr.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_7iLDkCZ5Fp3KQWW0aQer2w_eN84SfST';

// Sem isto, Wi-Fi conectado sem internet deixa cada chamada REST/RPC pendurada
// até o timeout do navegador (dezenas de segundos) antes de cair no cache
// offline — o app parece travado. Aqui: offline conhecido falha na hora, e
// leituras REST/RPC ganham teto de 8s. O erro vira TypeError/AbortError, que
// `isNetworkError` já trata como rede e aciona o fallback de cache/fila.
const REST_TIMEOUT_MS = 15000;
// Validade do "offline detectado": curta, porque uma falha isolada do ping não pode travar o app por meio minuto.
export const OFFLINE_FLAG_MS = 8000;
const LOGIN_TIMEOUT_MS = 15000;
const fetchComFalhaRapida: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  // navigator.onLine NÃO decide nada: no Android (economia de bateria) e no Electron ele fica false com a rede funcionando,
  // e o app inteiro virava "sem internet". Quem decide é o teste real de rede (lib/offline/network.ts); sem rede de
  // verdade o fetch falha sozinho em instantes.
  // Offline já detectado pelo ping de conectividade (lib/offline/network.ts):
  // falha na hora, sem esperar o timeout do navegador (Wi-Fi sem internet).
  // Só LEITURAS falham na hora por esse aviso. Escrita e login sempre tentam a rede de verdade: a fila offline já
  // trata o erro de rede, e bloquear o login/pedido por um ping ruim foi o que travou o Sertão em 04/10.
  const method = (init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
  const ehLeitura = method === 'GET' || method === 'HEAD' || url.includes('/rest/v1/rpc/fetch_');
  const off = (globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt;
  if (ehLeitura && off && Date.now() - off < OFFLINE_FLAG_MS && url.includes('/rest/v1/') && !url.endsWith('/rest/v1/')) {
    return Promise.reject(new TypeError('Failed to fetch (offline detectado)'));
  }
  // Qualquer resposta do servidor prova que a rede está de pé: limpa o aviso.
  const limpaAviso = (r: Response) => { delete (globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt; return r; };
  if (!url.includes('/rest/v1/')) return fetch(input, init);
  // Login: teto próprio (o spinner nunca fica infinito), sem bloquear por aviso de offline.
  const ehLogin = url.includes('/rest/v1/rpc/authenticate_') || url.includes('/rest/v1/rpc/verify_store_staff_password');
  // Escrita que já chegou no servidor não pode ser abortada: a fila offline reenviaria e duplicaria o pedido.
  if (!ehLeitura && !ehLogin) return fetch(input, init).then(limpaAviso);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ehLogin ? LOGIN_TIMEOUT_MS : REST_TIMEOUT_MS);
  init?.signal?.addEventListener('abort', () => controller.abort());
  return fetch(input, { ...init, signal: controller.signal }).then(limpaAviso).finally(() => clearTimeout(timer));
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
