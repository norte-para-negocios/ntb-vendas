// rodar com: npx tsx scripts/testes/undoGuard.test.ts
import assert from 'node:assert/strict';
import { canUndo } from '../../lib/undoGuard';

assert.equal(canUndo('mesa-B', 'mesa-B'), true, 'item ainda está onde a ação deixou');
assert.equal(canUndo('mesa-B', 'mesa-C'), false, 'Review Focus 4: outra pessoa já moveu de novo');
assert.equal(canUndo('esgotado', 'disponivel'), false, 'alguém já reativou');
console.log('undoGuard: ok');
