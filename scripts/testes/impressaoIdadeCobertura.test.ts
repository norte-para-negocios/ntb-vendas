// rodar com: npx tsx scripts/testes/impressaoIdadeCobertura.test.ts   (na raiz do repo)
// Trava de regressão: os caminhos de impressão automática têm que continuar passando pelo teto de idade.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ler = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

const estacao = ler('components/modules/CaixaPrintStation.tsx');
assert.match(estacao, /from '@\/lib\/impressaoIdade'/, 'Estação importa o teto');
assert.match(estacao, /particionarPorIdade\(candidatos, Date\.now\(\)\)/, 'seleção do que imprime passa pelo teto');
assert.match(estacao, /const toPrint = recentes\.filter/, 'toPrint parte só dos recentes');
assert.doesNotMatch(estacao, /const toPrint = items\.filter/, 'toPrint nunca parte de items cru');

assert.match(ler('desktop/electron/print-engine.js'), /created_at=gte\.\$\{limiteIdade\}/, 'motor desktop limita idade do job');
assert.match(ler('print-agent/agent.js'), /\.gte\('created_at'/, 'agente de rede/USB limita idade do job');
console.log('impressaoIdadeCobertura: ok');
