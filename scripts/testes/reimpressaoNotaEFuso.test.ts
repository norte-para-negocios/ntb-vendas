// rodar com: npx tsx scripts/testes/reimpressaoNotaEFuso.test.ts
// 05/10/2026: (1) o servidor roda em Europe/Berlin e o PDF da NFC-e saía com a data do dia seguinte;
// (2) o caixa reimprime a nota na mesma impressora do fechamento, e cada toque tem chave própria.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { format, parseISO } from 'date-fns';

const instr = readFileSync('instrumentation.ts', 'utf8');
assert.match(instr, /process\.env\.TZ\s*=\s*'America\/Sao_Paulo'/, 'instrumentation precisa fixar o fuso do Brasil');
assert.ok(instr.indexOf("process.env.TZ") < instr.indexOf('verificarNotasEmContingencia'), 'o fuso vem antes de qualquer job');

// Reproduz o bug: com o fuso do processo em Berlim a nota das 21h de 05/10 vira 06/10; com o fix, não.
const dhEmi = '2026-10-05T21:05:45-03:00';
const antes = process.env.TZ;
process.env.TZ = 'Europe/Berlin';
assert.equal(format(parseISO(dhEmi), 'dd/MM/yyyy HH:mm:ss'), '06/10/2026 02:05:45');
process.env.TZ = 'America/Sao_Paulo';
assert.equal(format(parseISO(dhEmi), 'dd/MM/yyyy HH:mm:ss'), '05/10/2026 21:05:45');
assert.equal(new Date(dhEmi).toLocaleDateString('pt-BR'), '05/10/2026');
if (antes === undefined) delete process.env.TZ; else process.env.TZ = antes;

// Reimpressão: chave com carimbo (não colide com a do fechamento) e aviso quando não há impressora.
const tela = readFileSync('components/modules/StoreModule.tsx', 'utf8');
assert.match(tela, /cupom-fiscal-reimp:\$\{nota\.id\}:\$\{carimbo\}:\$\{via\}/);
assert.match(tela, /Nenhuma impressora de cupom fiscal está configurada/);
assert.match(tela, /modoCaixa/, 'no Caixa só consulta e reimprime');
const api = readFileSync('lib/api.ts', 'utf8');
assert.match(api, /return impressorasCupom\.length;/);
console.log('reimpressaoNotaEFuso: ok');
