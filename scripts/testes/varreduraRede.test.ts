// rodar com: npx tsx scripts/testes/varreduraRede.test.ts
import assert from 'node:assert/strict';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const v = require('../../desktop/electron/varredura-rede.js');

const reservados = v.ipsDasPortas('192.168.123.100\r\n192.168.123.101\r\nPORTPROMPT:\r\nimpressora.local\r\n\r\n');
assert.deepEqual([...reservados], ['192.168.123.100', '192.168.123.101'], 'só IPv4');
const alvos = v.alvosDaVarredura(['192.168.123'], new Set(['192.168.123.10']), reservados);
assert.equal(alvos.length, 251, '254 menos a máquina e as duas impressoras');
for (const ip of ['192.168.123.100', '192.168.123.101', '192.168.123.10']) assert.ok(!alvos.includes(ip), `${ip} nunca é testado`);
assert.deepEqual(v.resultadoDaVarredura(['192.168.123.50'], reservados), ['192.168.123.100:9100', '192.168.123.101:9100', '192.168.123.50:9100'], 'instalada conta como achada sem testar');

const agora = Date.parse('2026-11-02T12:00:00Z');
assert.deepEqual(v.resumoDaFila('', agora), { total: 0, mais_antigo_s: 0, trabalhos: [] }, 'fila vazia');
const um = v.resumoDaFila('{"impressora":"NFC - CAIXA","documento":"NTB Vendas","estado":"Error, Printing","bytes":900,"enviado":"2026-11-02T11:58:00Z"}', agora);
assert.equal(um.total, 1); assert.equal(um.mais_antigo_s, 120); assert.equal(um.trabalhos[0].impressora, 'NFC - CAIXA');
assert.equal(v.resumoDaFila('[{"enviado":"x"},{"enviado":"2026-11-02T11:59:00Z"}]', agora).mais_antigo_s, 60);
assert.equal(v.resumoDaFila('erro do powershell', agora), null, 'saída inválida não vira fila vazia');
console.log('varreduraRede: ok');
