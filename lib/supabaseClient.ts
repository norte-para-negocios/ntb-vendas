import { createClient } from '@supabase/supabase-js';
import { cabecalhoAtor } from '@/lib/atorAtual';

// Reserva = o servidor de PRODUÇÃO (Contabo). Até 04/10/2026 a reserva era o Supabase Cloud antigo (já apagado): builds do
// app feitos sem desktop/webapp/.env.local (worktree) saíram apontando para ele e os PCs/celulares ficaram "Sem internet"
// (1.2.84/1.2.85 e 1.0.20/1.0.21). scripts/conferir-bundle.mjs barra o build se isso voltar.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://testvendase.norteparanegocios.com.br';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0ODQ3MjYwLCJleHAiOjE5NDI1MjcyNjB9.YmlPFysJDamnhjkRwwNDOqNhzPIVtmrIjlucfDKPOv4';

// Sem isto, Wi-Fi conectado sem internet deixa cada chamada REST/RPC pendurada
// até o timeout do navegador (dezenas de segundos) antes de cair no cache
// offline — o app parece travado. Aqui: offline conhecido falha na hora, e
// leituras REST/RPC ganham teto de 8s. O erro vira TypeError/AbortError, que
// `isNetworkError` já trata como rede e aciona o fallback de cache/fila.
const REST_TIMEOUT_MS = 6000;
// Validade do "offline detectado": curta, porque uma falha isolada do ping não pode travar o app por meio minuto.
export const OFFLINE_FLAG_MS = 8000;
const LOGIN_TIMEOUT_MS = 15000;
const fetchComFalhaRapida: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  // Auditoria: quem está logado vai em toda requisição ao banco (o banco grava o autor de cada mudança).
  const ator = url.includes('/rest/v1/') ? cabecalhoAtor() : null;
  if (ator) { const h = new Headers(init?.headers); h.set('x-ntb-actor', ator); init = { ...init, headers: h }; }
  // navigator.onLine NÃO decide nada: no Android (economia de bateria) e no Electron ele fica false com a rede funcionando,
  // e o app inteiro virava "sem internet". Quem decide é o teste real de rede (lib/offline/network.ts); sem rede de
  // verdade o fetch falha sozinho em instantes.
  // Offline já detectado pelo ping de conectividade (lib/offline/network.ts):
  // falha na hora, sem esperar o timeout do navegador (Wi-Fi sem internet).
  // Só LEITURAS falham na hora por esse aviso. Escrita e login sempre tentam a rede de verdade: a fila offline já
  // trata o erro de rede, e bloquear o login/pedido por um ping ruim foi o que travou o Sertão em 04/10.
  const method = (init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
  // Leituras: GET/HEAD e RPCs de consulta (fetch_*, get_*, count_*), inclusive get_tables_secure, que é POST.
  // 08/10/2026: list_ (nomes da equipe para o pedido) também: sem internet ela ficava pendurada e o garçom não
  // conseguia escolher o nome ("Carregando os nomes..." para sempre).
  const ehLeitura = method === 'GET' || method === 'HEAD' || /\/rest\/v1\/rpc\/(fetch_|get_|count_|list_)/.test(url);
  // Conferência da senha do PEDIDO (não é login): sem internet confere no aparelho na hora, sem esperar o servidor.
  const ehSenhaPedido = url.includes('/rest/v1/rpc/verify_store_staff_');
  // Relatórios de período longo podem passar de 15 s com a internet boa: teto próprio, para não "falhar como rede".
  const ehRelatorio = /\/rest\/v1\/rpc\/fetch_(sales_history|exceptions_report|cash_shifts_history)/.test(url);
  const off = (globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt;
  if ((ehLeitura || ehSenhaPedido) && off && Date.now() - off < OFFLINE_FLAG_MS && url.includes('/rest/v1/') && !url.endsWith('/rest/v1/')) {
    return Promise.reject(new TypeError('Failed to fetch (offline detectado)'));
  }
  // Qualquer resposta do servidor prova que a rede está de pé: limpa o aviso.
  const limpaAviso = (r: Response) => { delete (globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt; return r; };
  if (!url.includes('/rest/v1/')) return fetch(input, init);
  // Login: teto próprio (o spinner nunca fica infinito), sem bloquear por aviso de offline.
  const ehLogin = url.includes('/rest/v1/rpc/authenticate_') || ehSenhaPedido;
  // Escrita que já chegou no servidor não pode ser abortada: a fila offline reenviaria e duplicaria o pedido.
  // Mas se o app JÁ sabe que está sem internet, nem manda (08/10/2026): falha na hora como rede, e quem grava põe na
  // fila do aparelho (abrir mesa, pedido, pagamento...). Antes ficava pendurada até o tempo-limite do sistema
  // (20 a 70 s) e a mesa "voltava a ficar livre" na tela. Nada foi enviado, então não há risco de duplicar.
  if (!ehLeitura && !ehLogin) {
    if (off && Date.now() - off < OFFLINE_FLAG_MS) return Promise.reject(new TypeError('Failed to fetch (offline detectado)'));
    return fetch(input, init).then(limpaAviso);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ehSenhaPedido ? 5000 : ehLogin ? LOGIN_TIMEOUT_MS : ehRelatorio ? 60000 : REST_TIMEOUT_MS);
  if (init?.signal?.aborted) controller.abort();
  init?.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  // Leitura que não chegou ao servidor (tempo esgotado ou rede): marca "sem internet" na hora, para as próximas
  // falharem em instantes e o app usar o que tem no aparelho, em vez de travar 8 s em cada tela.
  const marcaSemInternet = (e: unknown) => {
    if (!init?.signal?.aborted) (globalThis as { __ntbOfflineAt?: number }).__ntbOfflineAt = Date.now();
    throw e;
  };
  return fetch(input, { ...init, signal: controller.signal }).then(limpaAviso, marcaSemInternet).finally(() => clearTimeout(timer));
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
