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

// BottomSheet do cardápio: sem vidro escuro nem branco fixo
const ini = cli.indexOf('function BottomSheet(');
const fim = cli.indexOf('const CartModal');
assert.ok(ini > 0 && fim > ini, 'achou o BottomSheet no ClientModule');
const bottomSheet = cli.slice(ini, fim);
assert.equal(conta(bottomSheet, /on-glass|u-glass-modal/g), 0, 'BottomSheet não força tema');
assert.equal(conta(bottomSheet, /bg-white\/|border-white|rgba\(255,\s*255,\s*255/g), 0, 'BottomSheet sem branco translúcido fixo');
// Botão cheio com texto branco usa o token de preenchimento (contraste nos dois temas)
assert.equal(conta(cli, /bg-\[var\(--brand\)\] text-white/g), 0, 'botão cheio usa --brand-fill, não --brand');

// Barras flutuantes, pílula, faixas e tela de identificação: seguem o tema (dono pediu tudo claro em 04/10)
assert.equal(conta(cli, /on-glass|u-glass-cart|u-glass-modal/g), 0, 'nenhum vidro escuro fixo no cardápio do cliente');
assert.equal(conta(cli, /bg-\[var\(--ink\)\]/g), 0, 'nenhuma faixa --ink fixa no cardápio do cliente');
const css = ler('app/globals.css');
assert.equal(conta(css, /^\.on-glass\s*\{/gm), 0, '.on-glass removido do CSS');
assert.equal(conta(css, /^\.u-glass-cart\s*\{/gm), 0, '.u-glass-cart removido do CSS');

console.log('temaCoerente: ok');
