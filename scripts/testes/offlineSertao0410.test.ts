// rodar com: npx tsx scripts/testes/offlineSertao0410.test.ts
// Regressão dos bugs que pararam o Sertão em 04/10/2026 (PC com "Sem internet" e a rede funcionando, pedido que não
// entrava, fila que estacionava, "Senha incorreta" mentindo, mesas congeladas). Cada bloco reproduz um relato.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------- ambiente simulado: Windows com navigator.onLine = false e rede funcionando ----------
const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear() },
  configurable: true,
});
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });

type Resposta = { status?: number; body?: unknown } | 'rede-caiu';
let roteiro: (url: string, init?: RequestInit) => Resposta = () => ({ body: {} });
const chamadas: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  chamadas.push(url);
  const r = roteiro(url, init);
  if (r === 'rede-caiu') throw new TypeError('Failed to fetch');
  return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
const g = globalThis as { __ntbOfflineAt?: number };

async function main() {
  const { checkRealConnectivity, isNetworkError } = await import('../../lib/offline/network');
  const { supabase } = await import('../../lib/supabaseClient');
  const api = await import('../../lib/api');

  // 1) navigator.onLine = false NÃO pode decidir: com o servidor respondendo, está online (PC do caixa congelado 4 h).
  roteiro = () => ({ body: {} });
  delete g.__ntbOfflineAt;
  assert.equal(await checkRealConnectivity(), true, 'navigator.onLine=false com rede boa tem que dar online');
  assert.equal(g.__ntbOfflineAt, undefined, 'não marca offline');

  // 2) Um engasgo isolado do Wi-Fi não derruba o app (2 tentativas antes de declarar offline).
  await new Promise((r) => setTimeout(r, 3100)); // passa a janela de "resultado recente"
  let n = 0;
  roteiro = (u) => (u.endsWith('/rest/v1/') && n++ === 0 ? 'rede-caiu' : { body: {} });
  assert.equal(await checkRealConnectivity(), true, 'uma falha seguida de sucesso = online');
  assert.equal(g.__ntbOfflineAt, undefined);

  // 3) Rede caída de verdade: offline, e o aviso dura pouco (não 30 s).
  await new Promise((r) => setTimeout(r, 3100));
  roteiro = () => 'rede-caiu';
  assert.equal(await checkRealConnectivity(), false, 'duas falhas = offline');
  assert.ok(g.__ntbOfflineAt, 'marca offline');
  const { OFFLINE_FLAG_MS } = await import('../../lib/supabaseClient');
  assert.ok(OFFLINE_FLAG_MS <= 10000, `aviso de offline curto (${OFFLINE_FLAG_MS} ms)`);

  // 4) Com o aviso ligado, ESCRITA e LOGIN ainda tentam a rede (pedido e senha nunca bloqueados pelo aviso);
  //    só leitura falha na hora (mesas usam o último dado bom).
  g.__ntbOfflineAt = Date.now();
  roteiro = () => ({ body: { success: true } });
  chamadas.length = 0;
  await supabase.rpc('create_order_secure', {});
  assert.ok(chamadas.some((u) => u.includes('create_order_secure')), 'pedido foi para a rede mesmo com o aviso de offline');
  chamadas.length = 0;
  await supabase.rpc('authenticate_store_user_secure', { p_email: 'x', p_password: 'y' });
  assert.ok(chamadas.some((u) => u.includes('authenticate_store_user_secure')), 'login foi para a rede mesmo com o aviso');
  g.__ntbOfflineAt = Date.now();
  chamadas.length = 0;
  const leitura = await supabase.rpc('get_tables_secure', { p_store_id: 's' });
  assert.ok(leitura.error, 'leitura com aviso ligado falha rápido');
  assert.equal(chamadas.filter((u) => u.includes('get_tables_secure')).length, 0, 'sem pendurar na rede');
  assert.ok(isNetworkError(leitura.error), 'e é tratada como rede (cai no último dado bom)');
  delete g.__ntbOfflineAt;

  // 5) "Senha incorreta" só quando a senha é errada; sem conexão / bloqueio dizem a verdade.
  roteiro = () => 'rede-caiu';
  assert.equal((await api.authenticateStoreUser('a@a', '1')).reason, 'network', 'rede caída = network');
  delete g.__ntbOfflineAt;
  roteiro = () => ({ body: null });
  assert.equal((await api.authenticateStoreUser('a@a', '1')).reason, 'network', 'resposta vazia = network, não apaga senha salva');
  roteiro = () => ({ body: { success: false, locked: true } });
  assert.equal((await api.authenticateStoreUser('a@a', '1')).reason, 'locked');
  roteiro = () => ({ body: { success: false } });
  assert.equal((await api.authenticateStoreUser('a@a', '1')).reason, 'wrong');

  // 6) Pedido com senha sem internet: quem já se identificou neste aparelho continua lançando; senha errada não passa.
  mem.clear();
  await api.registrarSenhaConferida('loja-sertao', '4321', { id: 'u-jeff', name: 'Jefferson', role: 'waiter' });
  roteiro = () => 'rede-caiu';
  const ok = await api.verificarSenhaEquipe('loja-sertao', '4321');
  assert.equal(ok.success, true, 'senha conferida antes vale offline');
  if (ok.success) assert.equal(ok.name, 'Jefferson');
  const errada = await api.verificarSenhaEquipe('loja-sertao', '9999');
  assert.equal(errada.success, false, 'senha errada offline não passa');
  const outraLoja = await api.verificarSenhaEquipe('outra-loja', '4321');
  assert.equal(outraLoja.success, false, 'senha de uma loja não vale em outra');
  assert.ok(![...mem.values()].some((v) => v.includes('4321')), 'a senha nunca fica gravada em texto');
  // senha trocada: a antiga para de valer quando a nova é conferida online
  await api.registrarSenhaConferida('loja-sertao', '5555', { id: 'u-jeff', name: 'Jefferson', role: 'waiter' });
  assert.equal((await api.verificarSenhaEquipe('loja-sertao', '4321')).success, false, 'senha antiga invalidada');
  delete g.__ntbOfflineAt;

  // 7) Mesas não somem: leitura que falhou volta MARCADA (a tela mantém a última lista boa); lista vazia boa não é falha.
  //    (o caminho real usa IndexedDB, que não existe no Node: aqui confere a marcação e o código do caminho de erro)
  const falha = Object.defineProperty([], '__falhou', { value: true, enumerable: false });
  assert.equal(api.leituraFalhou(falha), true, 'lista marcada = falha');
  assert.equal(api.leituraFalhou([]), false, 'loja com 0 mesas ocupadas é dado bom, não falha');
  const apiSrc = readFileSync('lib/api.ts', 'utf8');
  assert.ok(apiSrc.includes('return marcarFalha([] as Table[]);') && apiSrc.includes('return marcarFalha([] as Order[]);'), 'mesas e pedidos que falharam voltam marcados');

  // 8) Travas de código que já falharam uma vez em silêncio (substituição que não aplicou em 04/10).
  const sync = readFileSync('lib/offline/sync.ts', 'utf8');
  const iBreak = sync.indexOf('if (isNetworkError(e)) break;');
  assert.ok(iBreak > 0 && iBreak < sync.indexOf("await markFailed(action.id"), 'erro de rede não gasta tentativa da fila');
  assert.ok(/rearmes \?\? 0\) < 1/.test(sync), 'rearme automático limitado (create_order não é idempotente)');
  const sc = readFileSync('lib/supabaseClient.ts', 'utf8');
  assert.ok(!/navigator\.onLine === false\)\s*\{\s*return Promise\.reject/.test(sc), 'fetch nunca rejeita por navigator.onLine');
  for (const f of ['lib/offline/network.ts', 'components/StaffOfflineBanner.tsx', 'components/modules/CaixaPrintStation.tsx', 'lib/useStoreNotifications.ts']) {
    assert.ok(!/navigator\.onLine\s*(===|&&|\))|!navigator\.onLine|setOnline\(navigator\.onLine/.test(readFileSync(f, 'utf8')), `${f} não decide nada por navigator.onLine`);
  }
  const est = readFileSync('components/modules/CaixaPrintStation.tsx', 'utf8');
  assert.ok(est.includes('comTeto(envios)'), 'envio à fila de impressão tem teto de tempo');
  assert.ok(/const retry = refazer \?/.test(est), '"Tentar de novo" reenfileira na impressora cadastrada');
  const motor = readFileSync('desktop/electron/print-engine.js', 'utf8');
  assert.ok(/signal: AbortSignal\.timeout\(REST_TIMEOUT_MS\)/.test(motor), 'motor de impressão com timeout em toda chamada');
  assert.ok(motor.includes('ciclo de impressão preso há mais de 3 min'), 'motor destrava ciclo preso');
  const sm = readFileSync('components/modules/StoreModule.tsx', 'utf8');
  assert.ok(sm.includes('if (seq < loadDataAplicado.current) return;'), 'lista de mesas não congela em horário de pico');
  assert.ok(/manual:\$\{tableId\}:\$\{receiptOpts\.items\.length\}/.test(sm), 'comanda manual não duplica em toque repetido');

  console.log('offlineSertao0410: todos os casos passaram');
}
main().catch((e) => { console.error(e); process.exit(1); });
