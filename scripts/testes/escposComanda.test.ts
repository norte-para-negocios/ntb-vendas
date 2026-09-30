// rodar com: npx tsx scripts/testes/escposComanda.test.ts
import assert from 'node:assert/strict';
import { buildKitchenTicketText } from '../../lib/print';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toEscPos } = require('../../desktop/electron/print-engine.js');

const itens = [{ quantity: 2, productName: 'Pizza Tradicional Grande com Borda Recheada de Catupiry', addons: 'Borda: Catupiry', observation: 'sem cebola' }];
const base = { kind: 'COZINHA' as const, storeName: 'O Sertão Vai Virar Mar', orderType: 'MESA', identifier: 'MESA 4', orderIdShort: 'abc12345', items: itens };

// Impressora em modo direto (raw): comanda diagramada pra LETRA DUPLA (metade das colunas do papel).
for (const [mm, W] of [[80, 24], [58, 16]] as const) {
  const t = buildKitchenTicketText({ ...base, paperWidthMm: mm, modoDireto: true });
  const cheias = t.split('\n').filter((x) => x.length > 0);
  assert.ok(cheias.every((x) => x.length <= W), `[${mm} raw] cabe em ${W} colunas: ${cheias.find((x) => x.length > W)}`);
  assert.ok(t.split('\n').some((x) => x === '='.repeat(W)), `[${mm} raw] linha dupla na largura certa`);
}
// Modo driver continua como antes (32 colunas no 80 mm).
assert.ok(buildKitchenTicketText({ ...base, paperWidthMm: 80 }).split('\n').some((x) => x === '='.repeat(32)), 'driver 80 mm = 32 colunas');

const bytes = (b: Buffer) => Array.from(b);
const temSeq = (arr: number[], seq: number[]) => arr.some((_, i) => seq.every((v, j) => arr[i + j] === v));
// Comanda estreita (≤ metade das colunas) sai com letra dupla, negrito e alinhada à esquerda.
const comanda = bytes(toEscPos(buildKitchenTicketText({ ...base, paperWidthMm: 80, modoDireto: true }), 80));
assert.ok(temSeq(comanda, [0x1d, 0x21, 0x11]), 'letra dupla (largura+altura)');
assert.ok(temSeq(comanda, [0x1b, 0x45, 0x01]), 'negrito');
assert.ok(temSeq(comanda, [0x1b, 0x61, 0x00]) && !temSeq(comanda, [0x1b, 0x61, 0x01]), 'alinhado à esquerda (o texto já vem diagramado)');
// Conta/cupom em 48 colunas: tamanho normal (senão quebraria as linhas).
const conta = bytes(toEscPos('='.repeat(48) + '\nTOTAL' + ' '.repeat(34) + 'R$ 10,00', 80));
assert.ok(!temSeq(conta, [0x1d, 0x21, 0x11]), 'conta larga não dobra a letra');
console.log('ok');
