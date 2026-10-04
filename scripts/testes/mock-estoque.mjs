// Servidor MOCK do Norte Estoque (só para teste local; nunca fala com o Omie nem com o Estoque real).
// Responde como as rotas reais de ntb-estoque/app/api/integracao/*:
//   POST /api/integracao/ordem-producao   (Bearer <chave>; resposta { lojaId, resultados:[{codigo, ok, nCodOP, op, baixa, erro}] })
//   GET  /api/integracao/locais-estoque   (Bearer; 200 { locais } ou 401)
//   POST /api/integracao/nota-fiscal      (ImportarNFCe; cenário pelo prefixo da chNFe, ver abaixo)
//   GET  /api/integracao/status           (se MOCK_STATUS=off responde 404, como o Estoque antigo)
// Controle por código do item (POST /__mock/regra {codigo, tipo, vezes?}) — sem regra o item vai ok:
//   ok | sem_estrutura | pulada (sem cadastro, nada gravado) | op_erro (OP criada, conclusão falhou)
//   | sem_local (OP criada, sem local p/ saída) | http500 | hang (não responde) | drop (derruba a conexão)
// `vezes`: aplica a regra N chamadas e depois volta a ok. GET /__mock/log lista cada chamada recebida;
// POST /__mock/reset limpa tudo. Uso: node scripts/testes/mock-estoque.mjs [porta] [chave]
import http from 'node:http';

const PORTA = Number(process.argv[2] || process.env.MOCK_PORTA || 9191);
const CHAVE = process.argv[3] || process.env.MOCK_CHAVE || 'chave-mock-estoque';
let regras = {};
let log = [];
let nOP = 9000;
let statusCfg = { modo: process.env.MOCK_STATUS === 'off' ? 'off' : 'on', nome: 'Loja Mock (teste)', simulada: true, omieReal: false };

const ler = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b || 'null')); } catch { resolve(null); } }); });
const enviar = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

function aplicaRegra(codigo) {
  const r = regras[codigo];
  if (!r) return 'ok';
  if (r.vezes !== undefined) { if (r.vezes <= 0) return 'ok'; r.vezes -= 1; }
  return r.tipo;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__mock/regra' && req.method === 'POST') { const b = await ler(req); regras[b.codigo] = { tipo: b.tipo, vezes: b.vezes }; return enviar(res, 200, { ok: true }); }
  if (url.pathname === '/__mock/status' && req.method === 'POST') { statusCfg = { ...statusCfg, ...(await ler(req)) }; return enviar(res, 200, statusCfg); }
  if (url.pathname === '/__mock/reset' && req.method === 'POST') { regras = {}; log = []; return enviar(res, 200, { ok: true }); }
  if (url.pathname === '/__mock/log') return enviar(res, 200, log);

  const auth = req.headers.authorization || '';
  const okChave = auth === `Bearer ${CHAVE}`;

  if (url.pathname === '/api/integracao/locais-estoque' && req.method === 'GET') {
    if (!okChave) return enviar(res, 401, { error: 'Chave de integração inválida' });
    return enviar(res, 200, { locais: [{ codigo: 111, nome: 'Local Mock 1' }, { codigo: 222, nome: 'Local Mock 2' }] });
  }
  if (url.pathname === '/api/integracao/status' && req.method === 'GET') {
    if (statusCfg.modo === 'off') { res.writeHead(404); return res.end('Not found'); }
    if (!okChave) return enviar(res, 401, { error: 'Chave de integração inválida' });
    return enviar(res, 200, { nome: statusCfg.nome, simulada: statusCfg.simulada, omieReal: statusCfg.omieReal, versao: 'mock' });
  }
  if (url.pathname === '/api/integracao/ordem-producao' && req.method === 'POST') {
    const body = await ler(req);
    if (!okChave) return enviar(res, 401, { error: 'Chave de integração inválida' });
    if (!body?.itens?.length) return enviar(res, 400, { error: 'Informe itens: [{ codigo, quantidade }]' });
    const codigos = body.itens.map((i) => i.codigo);
    const decisoes = codigos.map(aplicaRegra);
    log.push({ em: new Date().toISOString(), pedidoRef: body.pedidoRef ?? null, ambiente: body.ambiente ?? null, itens: codigos, decisoes });
    if (decisoes.includes('hang')) return; // nunca responde: o chamador estoura o timeout
    if (decisoes.includes('drop')) return req.socket.destroy();
    if (decisoes.includes('http500')) return enviar(res, 500, { error: 'Erro interno simulado' });
    const resultados = codigos.map((codigo, i) => {
      switch (decisoes[i]) {
        case 'pulada': return { codigo, ok: false, op: 'pulada', baixa: 'pulada', erro: 'Produto sem cadastro correspondente no ntb-estoque' };
        case 'sem_estrutura': return { codigo, ok: true, op: 'sem_estrutura', baixa: 'Concluido' };
        case 'op_erro': return { codigo, ok: false, nCodOP: ++nOP, op: 'erro', baixa: 'Concluido', erro: '[OP criada, conclusão falhou] Movimentos pendentes de cálculo' };
        case 'sem_local': return { codigo, ok: true, nCodOP: ++nOP, op: 'criada', baixa: 'sem local de estoque' };
        default: return { codigo, ok: true, nCodOP: ++nOP, op: 'criada', baixa: 'Concluido' };
      }
    });
    return enviar(res, 200, { lojaId: 99, resultados });
  }
  if (url.pathname === '/api/integracao/nota-fiscal' && req.method === 'POST') {
    // Registro da NFC-e no Omie (ImportarNFCe). Como a rota real, responde 200 até quando falha. Cenário pelo prefixo da chNFe:
    // ERR -> ok:false definitivo; FILA -> ok:false naFila; SKIP -> skipped; H500 -> HTTP 500; demais -> ok.
    const body = await ler(req);
    if (!okChave) return enviar(res, 401, { error: 'Chave de integração inválida' });
    if (!body?.chNFe || !body.itens?.length) return enviar(res, 400, { error: 'Payload inválido: chNFe e itens são obrigatórios' });
    log.push({ em: new Date().toISOString(), rota: 'nota-fiscal', chNFe: body.chNFe });
    if (body.chNFe.startsWith('H500')) return enviar(res, 500, { error: 'Erro interno simulado' });
    if (body.chNFe.startsWith('ERR')) return enviar(res, 200, { ok: false, naFila: false, reason: 'NCM inválido para o produto 90001' });
    if (body.chNFe.startsWith('FILA')) return enviar(res, 200, { ok: false, naFila: true, reason: 'consumo redundante do Omie' });
    if (body.chNFe.startsWith('SKIP')) return enviar(res, 200, { skipped: true, reason: 'Loja sem Omie configurada' });
    return enviar(res, 200, { ok: true, resultado: { status: 'ok' } });
  }
  res.writeHead(404); res.end('Not found');
}).listen(PORTA, () => console.log(`mock-estoque na porta ${PORTA} (chave: ${CHAVE})`));
