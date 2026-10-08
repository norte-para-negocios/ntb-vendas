// rodar com: npx tsx scripts/testes/pedidoIdempotente.test.ts
// Pedido idempotente (05/10/2026): o mesmo pedido reenviado pela fila offline leva o MESMO client_request_id,
// e um banco sem a migration 162 cai na função antiga sem quebrar o pedido.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const todas: { url: string; body: any }[] = [];
// Só as gravações (o teste rápido de conexão antes de gravar, HEAD /rest/v1/, fica de fora).
const chamadas = new Proxy(todas, { get: (alvo, k) => (k === 'length' ? alvo.filter((c) => c.url.includes('/rpc/')).length : (Reflect.get(alvo.filter((c) => c.url.includes('/rpc/')), k))), set: (alvo, k, v) => { if (k === 'length') alvo.length = v; return true; } }) as { url: string; body: any }[];
let roteiro: (url: string) => { status: number; body: unknown } | 'rede' = () => ({ status: 200, body: { success: true, order_id: 'o1' } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  todas.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
  const r = roteiro(url);
  if (r === 'rede') throw new TypeError('Failed to fetch');
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

async function main() {
  const { chamarCriarPedido } = await import('../../lib/offline/criarPedido');
  const payload = { p_table_id: 't', p_store_id: 's', p_order_type: 'table', p_customer_name: null, p_items: [], p_added_by_role: 'garcom', p_added_by_name: 'x', p_client_request_id: '11111111-1111-1111-1111-111111111111' };

  // 1) usa a v3 e manda o id
  const r1 = await chamarCriarPedido(payload);
  assert.equal(r1.success, true);
  assert.ok(chamadas[0].url.includes('/rpc/create_order_v3'), 'chama a v3');
  assert.equal(chamadas[0].body.p_client_request_id, payload.p_client_request_id, 'o id viaja');

  // 2) banco sem a v3 (PGRST202): cai na antiga SEM o id
  chamadas.length = 0;
  roteiro = (u) => (u.includes('create_order_v3') ? { status: 404, body: { code: 'PGRST202', message: 'not found' } } : { status: 200, body: { success: true, order_id: 'o2' } });
  const r2 = await chamarCriarPedido(payload);
  assert.equal(r2.success, true);
  const antiga = chamadas.find((c) => c.url.includes('/rpc/create_order_secure'));
  assert.ok(antiga, 'fallback para a função antiga');
  assert.equal(antiga!.body.p_client_request_id, undefined, 'a antiga não recebe o id');

  // 3) reenvio com o mesmo payload manda o MESMO id e o servidor responde duplicado
  chamadas.length = 0; roteiro = () => ({ status: 200, body: { success: true, order_id: 'o1', duplicado: true } });
  const r3 = await chamarCriarPedido(payload);
  assert.equal(r3.duplicado, true);
  assert.equal(chamadas[0].body.p_client_request_id, payload.p_client_request_id);

  // 4) erro de negócio vira {success:false}; rede propaga (quem chama decide enfileirar)
  roteiro = () => ({ status: 200, body: { success: false, message: 'Mesa inválida' } });
  assert.equal((await chamarCriarPedido(payload)).success, false);
  roteiro = () => 'rede';
  await assert.rejects(() => chamarCriarPedido(payload));

  // 5) fiação: createOrder gera o id UMA vez (antes do try) e a fila usa o mesmo helper
  const api = readFileSync('lib/api.ts', 'utf8');
  assert.ok(api.includes('p_client_request_id: crypto.randomUUID()'), 'createOrder gera o client_request_id');
  assert.ok(api.includes('chamarCriarPedido(rpcPayload)'), 'createOrder usa o helper idempotente');
  const sync = readFileSync('lib/offline/sync.ts', 'utf8');
  assert.ok(sync.includes('chamarCriarPedido(rpcPayload)'), 'a fila reenvia pelo helper idempotente (mesmo id)');
  assert.ok(!/rpc\('create_order_secure'/.test(sync), 'sync.ts não chama mais a função antiga direto');

  console.log('pedidoIdempotente: todos os casos passaram');
}
main().catch((e) => { console.error(e); process.exit(1); });
