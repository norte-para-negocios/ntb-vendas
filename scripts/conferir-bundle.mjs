#!/usr/bin/env node
// Trava de build dos apps (04/10/2026): o bundle embutido no app tem que falar com o servidor de produção.
// 1.2.84/1.2.85 e 1.0.20/1.0.21 saíram com o Supabase Cloud antigo (apagado) porque foram construídos sem
// desktop/webapp/.env.local; PCs e celulares ficaram "Sem internet" com a rede boa.
// Uso: node scripts/conferir-bundle.mjs <pasta-do-bundle> | <arquivo.apk>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CERTO = 'testvendase.norteparanegocios.com.br';
const PROIBIDOS = ['giiwtnddasminjxweohr'];
const alvo = process.argv[2];
if (!alvo) { console.error('uso: conferir-bundle.mjs <pasta|apk>'); process.exit(2); }

let textos = [];
if (alvo.endsWith('.apk')) {
  const lista = execFileSync('unzip', ['-Z1', alvo]).toString().split('\n').filter((f) => /^assets\/public\/.*\.js$/.test(f));
  textos = lista.map((f) => execFileSync('unzip', ['-p', alvo, f], { maxBuffer: 64 * 1024 * 1024 }).toString());
} else {
  const andar = (d) => readdirSync(d).forEach((n) => { const p = join(d, n); if (statSync(p).isDirectory()) andar(p); else if (p.endsWith('.js')) textos.push(readFileSync(p, 'utf8')); });
  andar(alvo);
}
if (textos.length === 0) { console.error(`conferir-bundle: nenhum .js em ${alvo}`); process.exit(1); }
const proibido = PROIBIDOS.find((x) => textos.some((t) => t.includes(x)));
if (proibido) { console.error(`conferir-bundle: FALHOU — o bundle aponta para ${proibido} (servidor errado). Falta o .env.local do webapp?`); process.exit(1); }
if (!textos.some((t) => t.includes(CERTO))) { console.error(`conferir-bundle: FALHOU — ${CERTO} não aparece no bundle.`); process.exit(1); }
console.log(`conferir-bundle: ok (${textos.length} arquivos, servidor ${CERTO})`);
