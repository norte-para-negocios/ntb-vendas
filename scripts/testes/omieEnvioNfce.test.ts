// rodar com: npx tsx scripts/testes/omieEnvioNfce.test.ts
// Envio da NFC-e autorizada ao Omie (ImportarNFCe via Estoque, ou direto): o resultado precisa ser registrado na nota,
// nunca engolido. A rota do Estoque responde HTTP 200 mesmo quando falha (ok:false), então o corpo é que manda.
import assert from 'node:assert/strict';
import { interpretarEnvioNfceEstoque, interpretarErroEnvioNfce, ENVIO_OMIE_OK } from '../../lib/omieEnvio';

// Estoque: registrou
assert.deepEqual(interpretarEnvioNfceEstoque(200, { ok: true, resultado: {} }), ENVIO_OMIE_OK);
// Estoque: falha transitória, ele reenfileira e reenvia sozinho
let r = interpretarEnvioNfceEstoque(200, { ok: false, naFila: true, reason: 'consumo redundante' });
assert.equal(r.status, 'na_fila');
assert.match(r.erro ?? '', /consumo redundante/);
// Estoque: falha definitiva (HTTP 200 com ok:false) — era engolida
r = interpretarEnvioNfceEstoque(200, { ok: false, naFila: false, reason: 'NCM inválido para o produto 90001' });
assert.equal(r.status, 'erro');
assert.match(r.erro ?? '', /NCM inválido/);
// Estoque: nada a fazer (loja sem Omie / homologação em loja real) não é erro
r = interpretarEnvioNfceEstoque(200, { skipped: true, reason: 'Loja sem Omie configurada' });
assert.equal(r.status, 'ignorada');
assert.match(r.erro ?? '', /sem Omie/);
// HTTP != 200 (chave inválida, payload inválido, 500): erro, com a mensagem do Estoque
r = interpretarEnvioNfceEstoque(401, { error: 'Chave de integração inválida' });
assert.equal(r.status, 'erro');
assert.match(r.erro ?? '', /Chave de integração inválida/);
assert.equal(interpretarEnvioNfceEstoque(500, null).status, 'erro');
assert.match(interpretarEnvioNfceEstoque(502, null).erro ?? '', /502/);
// 200 sem corpo reconhecível: não dá para afirmar que registrou
assert.equal(interpretarEnvioNfceEstoque(200, null).status, 'erro');
assert.equal(interpretarEnvioNfceEstoque(200, { qualquer: 1 }).status, 'erro');
// exceção (rede / Omie direto)
r = interpretarErroEnvioNfce(new Error('Omie: SOAP-ENV:Server 500'));
assert.equal(r.status, 'erro');
assert.match(r.erro ?? '', /SOAP-ENV/);
assert.equal(interpretarErroEnvioNfce('texto').status, 'erro');
// mensagem enorme é cortada (cabe numa coluna e na tela)
assert.ok((interpretarErroEnvioNfce(new Error('x'.repeat(5000))).erro ?? '').length <= 500);
console.log('ok');
