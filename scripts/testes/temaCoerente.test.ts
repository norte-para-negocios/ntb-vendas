// rodar com: npx tsx scripts/testes/temaCoerente.test.ts   (na raiz do repo)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const conta = (txt: string, re: RegExp) => (txt.match(re) ?? []).length;

const ui = ler('components/ui.tsx');
const cli = ler('components/modules/ClientModule.tsx');

// Regra: só a preferência da pessoa (.dark no <html>) decide claro/escuro. O Modal nunca força tema.
assert.equal(conta(ui, /on-glass|u-glass-modal|u-glass-cart/g), 0, 'Modal (ui.tsx) não pode usar o vidro escuro fixo');
assert.equal(conta(ui, /surface\?: 'glass'/g), 0, 'a prop surface do Modal foi removida');
assert.equal(conta(ui, /bg-white\/|border-white\/|text-white\/60/g), 0, 'sem branco translúcido fixo dentro do Modal');
assert.equal(conta(cli, /surface="opaque"/g), 0, 'chamadores não passam mais surface="opaque"');

console.log('temaCoerente (ui.tsx): ok');
