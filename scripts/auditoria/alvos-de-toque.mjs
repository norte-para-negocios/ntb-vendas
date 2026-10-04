// scripts/auditoria/alvos-de-toque.mjs
// Protege botões pequenos (h-7/8/9, w-7/8/9, min-h-9) com variantes só de celular (max-sm:).
// Uso: node scripts/auditoria/alvos-de-toque.mjs --check|--write [arquivos...]
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PEQUENO_ALTURA = /(^|[\s"'`])(h-7|h-8|h-9|min-h-9)(?=[\s"'`$]|$)/;
const PEQUENA_LARGURA = /(^|[\s"'`])(w-7|w-8|w-9)(?=[\s"'`$]|$)/;
const PROTEGIDO = /hit-44|min-h-11|max-sm:h-11|max-sm:min-h-11|(^|[\s"'`])h-1[1-9](?=[\s"'`$]|$)|(^|[\s"'`])h-12(?=[\s"'`$]|$)/;

export function protegerBotoes(source) {
  let changes = 0;
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ini = source.indexOf('<button', i);
    if (ini === -1 || !/[\s>]/.test(source[ini + 7] ?? '>')) {
      if (ini === -1) { out += source.slice(i); break; }
      out += source.slice(i, ini + 7); i = ini + 7; continue;
    }
    // fim da tag de abertura: primeiro ">" fora de chaves e de aspas (um "=>" dentro de onClick={...} não conta)
    let depth = 0, aspas = null, fim = -1;
    for (let j = ini + 7; j < source.length; j++) {
      const c = source[j];
      if (aspas) { if (c === aspas && source[j - 1] !== '\\') aspas = null; continue; }
      if (c === '"' || c === "'" || c === '`') { aspas = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { fim = j; break; }
    }
    if (fim === -1) { out += source.slice(i); break; }
    let tag = source.slice(ini, fim + 1);
    const m = tag.match(/className=(\{`([^`]*)`\}|"([^"]*)")/);
    if (m) {
      const literal = m[2] ?? m[3];
      const fixo = literal.split('${')[0];
      if (!PROTEGIDO.test(literal)) {
        const altura = PEQUENO_ALTURA.test(fixo);
        const largura = PEQUENA_LARGURA.test(fixo);
        if (altura || largura) {
          const extra = 'max-sm:min-h-11' + (largura ? ' max-sm:min-w-11' : '');
          const idx = literal.indexOf('${');
          const novo = idx === -1 ? `${literal} ${extra}` : `${literal.slice(0, idx).trimEnd()} ${extra} ${literal.slice(idx)}`;
          tag = tag.replace(literal, novo);
          changes += 1;
        }
      }
    }
    out += source.slice(i, ini) + tag;
    i = fim + 1;
  }
  return { source: out, changes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const modo = process.argv.includes('--write') ? 'write' : 'check';
  const arquivos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const alvos = arquivos.length ? arquivos : fs.readdirSync('components/modules').filter((f) => f.endsWith('.tsx')).map((f) => `components/modules/${f}`);
  let total = 0;
  for (const f of alvos) {
    const original = fs.readFileSync(f, 'utf8');
    const { source, changes } = protegerBotoes(original);
    if (changes > 0) {
      total += changes;
      console.log(`${f}: ${changes} botão(ões) ${modo === 'write' ? 'protegido(s)' : 'sem proteção'}`);
      if (modo === 'write') fs.writeFileSync(f, source);
    }
  }
  console.log(`total: ${total}`);
  if (modo === 'check' && total > 0) process.exit(1);
}
