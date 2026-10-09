// Rede local entre os computadores da loja (08/10/2026, pedido do dono: "se estão todos no Wi-Fi, sem internet eles
// têm que trocar informação; mesas, pedidos, pedir conta, tudo; nenhum computador como central").
//
// Cada app do Windows:
//  - se anuncia na rede da loja (UDP broadcast) com a loja e um id próprio, e descobre os outros da MESMA loja;
//  - serve por HTTP as ações que estão na fila sem internet DELE (abrir mesa, pedido, pedir conta, pagamento...);
//  - busca, a cada 1 s, as ações dos outros, e o app monta a tela com tudo (lib/offline/rede.ts).
// Sem dependência nenhuma (dgram/http do Node). Com internet isto continua ligado, mas não há fila para trocar.
// Só para a mesma loja: o pedido HTTP precisa trazer o id da loja (x-ntb-loja) igual ao deste computador.
const dgram = require('dgram');
const http = require('http');
const os = require('os');

const PORTA_HTTP = 47610;
const PORTA_UDP = 47611;
const ASSINATURA = 'norte-vendas-lan';

let estado = null; // { storeId, peerId, server, udp, porta, timers, minhas, sincronizadas, peers, remotos }

function log(m) { try { console.log(`[lan] ${m}`); } catch { /* */ } }

function enderecosDeBroadcast() {
  const lista = new Set(['255.255.255.255']);
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) {
      if (i.family !== 'IPv4' || i.internal || !i.netmask) continue;
      const ip = i.address.split('.').map(Number);
      const mask = i.netmask.split('.').map(Number);
      lista.add(ip.map((b, k) => (b | (~mask[k] & 255))).join('.'));
    }
  }
  return [...lista];
}

function parar() {
  if (!estado) return;
  for (const t of estado.timers) clearInterval(t);
  try { estado.server.close(); } catch { /* */ }
  try { estado.udp.close(); } catch { /* */ }
  estado = null;
}

function iniciar({ storeId, peerId, portaHttp = PORTA_HTTP, portaUdp = PORTA_UDP }) {
  if (estado && estado.storeId === storeId && estado.peerId === peerId) return { ok: true, porta: estado.porta };
  parar();
  const st = { storeId, peerId, porta: portaHttp, timers: [], minhas: [], sincronizadas: [], peers: new Map(), remotos: new Map(), portaUdp };
  estado = st;

  st.server = http.createServer((req, res) => {
    if (req.headers['x-ntb-loja'] !== st.storeId) { res.writeHead(403); return res.end(); }
    if (req.method === 'GET' && req.url === '/acoes') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ peerId: st.peerId, acoes: st.minhas, sincronizadas: st.sincronizadas, em: Date.now() }));
    }
    res.writeHead(404); res.end();
  });
  st.server.on('error', (e) => {
    // Porta ocupada (outro programa): tenta a próxima, até 5.
    if (e.code === 'EADDRINUSE' && st.porta < portaHttp + 5) { st.porta += 1; st.server.listen(st.porta, '0.0.0.0'); return; }
    log(`servidor: ${e.message}`);
  });
  st.server.listen(st.porta, '0.0.0.0');

  st.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  st.udp.on('error', (e) => log(`udp: ${e.message}`));
  st.udp.on('message', (buf, rinfo) => {
    try {
      const m = JSON.parse(buf.toString());
      if (m.a !== ASSINATURA || m.storeId !== st.storeId || m.peerId === st.peerId) return;
      st.peers.set(m.peerId, { ip: rinfo.address, porta: m.porta, visto: Date.now() });
    } catch { /* lixo na rede */ }
  });
  st.udp.bind(portaUdp, () => { try { st.udp.setBroadcast(true); } catch { /* */ } });

  const anunciar = () => {
    const msg = Buffer.from(JSON.stringify({ a: ASSINATURA, storeId: st.storeId, peerId: st.peerId, porta: st.porta }));
    for (const b of enderecosDeBroadcast()) st.udp.send(msg, st.portaUdp, b, () => {});
  };
  const buscar = () => {
    for (const [id, p] of st.peers) {
      if (Date.now() - p.visto > 20000) { st.peers.delete(id); continue; }
      const req = http.get({ host: p.ip, port: p.porta, path: '/acoes', headers: { 'x-ntb-loja': st.storeId }, timeout: 1500 }, (res) => {
        let corpo = '';
        res.on('data', (c) => { corpo += c; });
        res.on('end', () => {
          try { const d = JSON.parse(corpo); st.remotos.set(id, { acoes: d.acoes || [], sincronizadas: d.sincronizadas || [], em: Date.now() }); } catch { /* */ }
        });
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => {});
    }
    // Quem sumiu há mais de 10 min sai da lista (as ações dele que ninguém sincronizou continuam aqui até lá).
    for (const [id, r] of st.remotos) if (Date.now() - r.em > 10 * 60 * 1000) st.remotos.delete(id);
  };
  anunciar(); buscar();
  st.timers.push(setInterval(anunciar, 3000), setInterval(buscar, 1000));
  log(`ligado: loja ${storeId}, porta ${st.porta}`);
  return { ok: true, porta: st.porta };
}

/** O app publica a própria fila sem internet e os ids que ele já sincronizou (de qualquer computador). */
function publicar({ acoes, sincronizadas }) {
  if (!estado) return { ok: false };
  if (Array.isArray(acoes)) estado.minhas = acoes;
  if (Array.isArray(sincronizadas)) estado.sincronizadas = sincronizadas.slice(-2000);
  return { ok: true };
}

/** Ações dos outros computadores (com a origem) e os ids que eles já sincronizaram. */
function ler() {
  if (!estado) return { ok: false, acoes: [], sincronizadas: [], computadores: 0 };
  const acoes = []; const sinc = new Set();
  for (const [id, r] of estado.remotos) {
    for (const a of r.acoes) acoes.push({ ...a, origem: id, origemVistaEm: r.em });
    for (const s of r.sincronizadas) sinc.add(s);
  }
  return { ok: true, acoes, sincronizadas: [...sinc], computadores: estado.peers.size };
}

module.exports = { iniciar, parar, publicar, ler, PORTA_HTTP, PORTA_UDP };
