# Alvos de toque de 44px no painel da equipe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo botão tocável do painel da equipe (garçom, caixa, gerente) tem pelo menos 44 × 44 px no celular, sem mexer no layout do computador.

**Architecture:** Em vez de editar à mão 52 pontos, uma ferramenta de transformação (`scripts/auditoria/alvos-de-toque.mjs`) lê os `.tsx`, acha `<button>` com classes de tamanho pequeno (`h-7/8/9`, `w-7/8/9`, `min-h-9`) sem proteção e acrescenta só variantes `max-sm:` (celular, abaixo de 640 px). A mesma ferramenta, em modo `--check`, serve de teste: falha se sobrar botão pequeno sem proteção. Um trecho de console (`scripts/auditoria/medir-alvos.js`) mede os alvos reais na tela, pra conferir depois do deploy.

**Tech Stack:** Node (ESM, sem dependências), Tailwind v4 (`max-sm:`), `npx tsx` para testes.

**Spec:** pesquisa de design de 04/10 (WCAG 2.5.8, alvos de 44 px, 8 px de espaço entre alvos) e `docs/plans/2026-10-04-proximas-features.md`.

## Global Constraints

- Só variantes `max-sm:` (viewport < 640 px). Nada muda no computador.
- Nunca remover classe existente; só acrescentar `max-sm:min-h-11` (e `max-sm:min-w-11` quando o botão tem largura fixa pequena).
- Respeitar proteções já existentes: `hit-44`, `min-h-11`, `max-sm:h-11`, `max-sm:min-h-11`, `size="lg"`.
- Botão com `disabled`/estado visual não muda; só tamanho.
- Cada task termina com `npx tsc --noEmit` limpo e um commit.

## Review Focus

1. **`className` montado com template string** (`className={\`... ${x} ...\`}`): a ferramenta não pode quebrar a interpolação; ela só acrescenta texto fixo no trecho literal. Teste na Task 1.
2. **Botão com várias linhas, atributos entre `<button` e `className` e um `=>` dentro de `onClick={() => f()}`** (o `>` da seta não pode fechar a tag): o parser tem de achar o `className` certo e nenhum de outro elemento. Teste na Task 1 (este caso pegou um bug do primeiro parser baseado em regex).
3. **Botão já protegido** não pode receber classes duplicadas (idempotência: rodar duas vezes não muda nada). Teste na Task 1.
4. **Ícone redondo `w-8 h-8`**: precisa ganhar `max-sm:min-w-11 max-sm:min-h-11` e continuar redondo. Teste na Task 1.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `scripts/auditoria/alvos-de-toque.mjs` (novo) | exporta `protegerBotoes(source)` (puro) e roda em `--check` / `--write` |
| `scripts/testes/alvosDeToque.test.ts` (novo) | testa `protegerBotoes` |
| `scripts/auditoria/medir-alvos.js` (novo) | trecho para o console: lista elementos tocáveis < 44 px na tela aberta |

---

### Task 1: Ferramenta de proteção dos botões

**Files:**
- Create: `scripts/auditoria/alvos-de-toque.mjs`
- Test: `scripts/testes/alvosDeToque.test.ts`

**Interfaces:**
- Produces: `protegerBotoes(source: string): { source: string; changes: number }`

- [ ] **Step 1: Teste que falha**

```ts
// rodar com: npx tsx scripts/testes/alvosDeToque.test.ts
import assert from 'node:assert/strict';
// @ts-expect-error módulo .mjs sem tipos
import { protegerBotoes } from '../auditoria/alvos-de-toque.mjs';

// botão pequeno simples ganha proteção só de celular
const a = protegerBotoes('<button onClick={x} className="h-8 px-3 rounded-full">Ok</button>');
assert.equal(a.changes, 1);
assert.ok(a.source.includes('className="h-8 px-3 rounded-full max-sm:min-h-11"'));

// Review Focus 4: ícone redondo w-8 h-8 ganha largura e altura mínimas
const b = protegerBotoes('<button className="w-8 h-8 rounded-full grid">x</button>');
assert.ok(b.source.includes('max-sm:min-h-11') && b.source.includes('max-sm:min-w-11'));

// Review Focus 3: idempotente e respeita proteção existente
assert.equal(protegerBotoes(a.source).changes, 0, 'segunda passada não muda nada');
assert.equal(protegerBotoes('<button className="h-8 hit-44 px-2">x</button>').changes, 0, 'hit-44 já protege');
assert.equal(protegerBotoes('<button className="h-9 max-sm:h-11">x</button>').changes, 0, 'max-sm:h-11 já protege');
assert.equal(protegerBotoes('<button className="min-h-11 h-9">x</button>').changes, 0);

// botão grande ou sem classe de tamanho pequeno não muda
assert.equal(protegerBotoes('<button className="h-12 px-4">x</button>').changes, 0);
assert.equal(protegerBotoes('<button className="px-4 py-2">x</button>').changes, 0);

// Review Focus 2: atributos antes do className, várias linhas, e outro elemento depois
const multi = `<div className="h-8"><button
  type="button"
  onClick={() => f()}
  className="h-9 px-3"
>
  Salvar
</button></div>`;
const m = protegerBotoes(multi);
assert.equal(m.changes, 1);
assert.ok(m.source.startsWith('<div className="h-8">'), 'a div com h-8 não é tocada');
assert.ok(m.source.includes('className="h-9 px-3 max-sm:min-h-11"'));

// Review Focus 1: template string — só o trecho fixo recebe a classe, a interpolação fica intacta
const t = protegerBotoes('<button className={`h-9 px-3 ${on ? \'bg-a\' : \'bg-b\'}`}>x</button>');
assert.equal(t.changes, 1);
assert.ok(t.source.includes("className={`h-9 px-3 max-sm:min-h-11 ${on ? 'bg-a' : 'bg-b'}`}"));

// input/select não são botões: não mexe
assert.equal(protegerBotoes('<input className="h-8" />').changes, 0);
console.log('alvosDeToque: ok');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas" && npx tsx scripts/testes/alvosDeToque.test.ts`
Expected: FAIL com "Cannot find module '../auditoria/alvos-de-toque.mjs'"

- [ ] **Step 3: Implementação**

```js
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/testes/alvosDeToque.test.ts`
Expected: `alvosDeToque: ok`

- [ ] **Step 5: Commit**

```bash
git add scripts/auditoria/alvos-de-toque.mjs scripts/testes/alvosDeToque.test.ts
git commit -m "chore(ux): ferramenta que protege botões pequenos com alvos de 44px só no celular"
```

---

### Task 2: Aplicar nas telas da equipe e conferir

**Files:**
- Modify: `components/modules/*.tsx` (somente as classes `max-sm:`)

- [ ] **Step 1: Ver o que a ferramenta vai mudar (sem escrever)**

Run: `node scripts/auditoria/alvos-de-toque.mjs --check`
Expected: lista por arquivo e `total: N` (sai com código 1 enquanto houver botão sem proteção)

- [ ] **Step 2: Aplicar**

Run: `node scripts/auditoria/alvos-de-toque.mjs --write && node scripts/auditoria/alvos-de-toque.mjs --check`
Expected: segunda execução `total: 0` e código 0 (idempotente)

- [ ] **Step 3: Conferir que só variantes de celular foram acrescentadas**

Run: `git diff -U0 components | grep '^[-+]' | grep -v '^+++\|^---' | grep -v 'max-sm:min-' | head`
Expected: sem linhas de remoção de classe: cada linha `-` tem a `+` correspondente só com `max-sm:min-h-11`/`max-sm:min-w-11` a mais

- [ ] **Step 4: Verificar e commitar**

Run: `npx tsc --noEmit && for t in scripts/testes/*.test.ts; do npx tsx "$t" || echo FALHOU $t; done`
Commit: `git add components && git commit -m "style(ux): alvos de toque de 44px no celular em todos os botões pequenos do painel da equipe"`

---

### Task 3: Medidor de alvos para conferir na tela real

**Files:**
- Create: `scripts/auditoria/medir-alvos.js`

- [ ] **Step 1: Escrever o trecho de console**

```js
// Cole no console do navegador (ou em Eval do Chrome remoto) na tela aberta, com a janela na largura do celular.
// Lista elementos tocáveis visíveis com menos de 44 px de largura ou altura.
(() => {
  const sel = 'button, a[href], [role="button"], [role="tab"], select, input[type="checkbox"], input[type="radio"], summary';
  const pequenos = [...document.querySelectorAll(sel)].filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') return false;
    return r.width < 44 || r.height < 44;
  }).map((el) => {
    const r = el.getBoundingClientRect();
    return { texto: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.table(pequenos);
  return `${pequenos.length} alvo(s) abaixo de 44px`;
})();
```

- [ ] **Step 2: Commit**

`git add scripts/auditoria/medir-alvos.js && git commit -m "chore(ux): trecho de console que mede alvos de toque abaixo de 44px na tela aberta"`

---

## Self-review

- **Cobertura:** proteção mecânica de todos os botões pequenos (T1/T2) e medição na tela real (T3). Fora de escopo, por decisão: `input`/`select` pequenos (já têm `h-11` nos formulários novos) e redesenho de telas densas.
- **Placeholders:** nenhum; ferramenta e testes completos.
- **Tipos:** `protegerBotoes(source): { source, changes }` usada igual no teste e no `main`.
- **Review Focus:** 1, 2, 3 e 4 têm assertivas no teste da T1.
