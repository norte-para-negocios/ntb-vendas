// rodar com: npx tsx scripts/testes/redeCelular.test.ts
// Celular na rede da loja (13/10/2026): o celular troca fila e caixa com o computador por HTTP e manda pedido para imprimir.
// Sobe o servidor de rede local do app do Windows (desktop/electron/lan-peer.js) de verdade numa porta livre.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { criarLanCelular, faixasParaVarrer, juntarCaixas, type HttpNativo } from '../../lib/offline/lanCelular';

// parte pura
assert.deepEqual(faixasParaVarrer(['192.168.123.100', '192.168.123.101', '10.0.0.5', '8.8.8.8', '', 'lixo', '172.20.1.9']), ['192.168.123', '10.0.0', '172.20.1']);
const cx = juntarCaixas([[{ key: 'L::u', shift: null, updatedAt: 5 }], [{ key: 'L::u', shift: { id: 'aberto' }, updatedAt: 9 }, { key: 'L::v', shift: null, updatedAt: 1 }]]);
assert.equal((cx.get('L::u')!.shift as { id: string }).id, 'aberto');
assert.equal(cx.get('L::v')!.shift, null);

// ao vivo
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
const require = createRequire(import.meta.url);
const lanPeer = require('../../desktop/electron/lan-peer.js');
const PORTA = 47690 + Math.floor(Math.random() * 200);
lanPeer.iniciar({ storeId: 'LOJA', peerId: 'PC1', portaHttp: PORTA, portaUdp: PORTA + 1000 });
lanPeer.publicar({ acoes: [{ id: 'pc-a1', type: 'create_order', payload: { p_table_id: 'T1' }, createdAt: 1, attempts: 0 }], sincronizadas: [], caixas: [{ key: 'LOJA::universal', shift: { id: 'turno-1', status: 'open' }, updatedAt: 10 }] });

const httpNode: HttpNativo = (o) => new Promise((ok, falha) => {
  const u = new URL(o.url);
  const corpo = o.data !== undefined ? JSON.stringify(o.data) : undefined;
  const req = http.request({ host: u.hostname, port: Number(u.port), path: u.pathname, method: o.method, headers: o.headers, timeout: o.readTimeout || 1500 }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let d: unknown = t; try { d = JSON.parse(t); } catch { /* */ } ok({ status: res.statusCode || 0, data: d }); });
  });
  req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', falha);
  if (corpo) req.write(corpo); req.end();
});

mem.set('ntb-lan-pcs:LOJA', JSON.stringify([{ ip: '127.0.0.1', porta: PORTA, visto: 0 }]));
const cel = criarLanCelular(httpNode);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await cel.iniciar({ storeId: 'LOJA', peerId: 'CEL' });
  await cel.publicar({ acoes: [{ id: 'cel-a1', type: 'create_order', payload: { p_table_id: 'T2' }, createdAt: 2, attempts: 0 }], sincronizadas: [] });
  await espera(3500);

  // celular vê a fila e o caixa do computador
  const doCel = await cel.ler();
  assert.ok(doCel.acoes.some((a: any) => a.id === 'pc-a1' && a.origem === 'PC1'), 'celular vê o pedido do computador');
  assert.equal(doCel.computadores, 1);
  assert.equal((cel.caixas().get('LOJA::universal')!.shift as { id: string }).id, 'turno-1', 'celular vê o caixa aberto no computador');

  // computador vê a fila do celular
  const doPc = lanPeer.ler();
  assert.ok(doPc.acoes.some((a: any) => a.id === 'cel-a1' && a.origem === 'cel:CEL'), 'computador vê o pedido do celular');

  // pedido do celular para imprimir: chega uma vez, some depois de impresso
  const t = { destination: 'kitchen' as const, sectorId: null, title: '1x Moqueca — Mesa 2', content: 'COZINHA\n1x Moqueca', sig: '2|p|1|[Ana]' };
  assert.equal(await cel.imprimir('pedido-1', [t]), true);
  assert.equal(await cel.imprimir('pedido-1', [t]), true);
  assert.equal(lanPeer.ler().imprimir.length, 1, 'mesmo pedido não entra duas vezes');
  lanPeer.publicar({ impressos: ['pedido-1'] });
  assert.equal(lanPeer.ler().imprimir.length, 0);
  assert.equal(await cel.imprimir('pedido-1', [t]), true);
  assert.equal(lanPeer.ler().imprimir.length, 0, 'já impresso não volta');

  // outra loja é recusada
  const outra = await httpNode({ url: `http://127.0.0.1:${PORTA}/acoes`, method: 'GET', headers: { 'x-ntb-loja': 'OUTRA' } });
  assert.equal(outra.status, 403);

  // o celular guardou o endereço do computador
  assert.ok(JSON.parse(mem.get('ntb-lan-pcs:LOJA') || '[]').some((p: any) => p.ip === '127.0.0.1' && p.peerId === 'PC1'));

  cel.parar(); lanPeer.parar();
  console.log('redeCelular: ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
