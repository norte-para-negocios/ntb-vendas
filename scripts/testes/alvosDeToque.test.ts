// rodar com: npx tsx scripts/testes/alvosDeToque.test.ts
import assert from 'node:assert/strict';
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
