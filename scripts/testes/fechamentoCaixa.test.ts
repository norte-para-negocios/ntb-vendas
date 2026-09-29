// rodar com: npx tsx scripts/testes/fechamentoCaixa.test.ts
import assert from 'node:assert/strict';
import { buildCashClosingText } from '../../lib/print';

for (const [mm, W] of [[80, 48], [58, 32]] as const) {
  const txt = buildCashClosingText({
    storeName: 'O Sertão Vai Virar Mar',
    operador: 'Gicelio Buery',
    abertoEm: new Date('2026-09-28T17:08:00-03:00'),
    fechadoEm: new Date('2026-09-28T22:07:00-03:00'),
    fundo: 100,
    formas: [
      { label: 'Dinheiro', total: 222.86 },
      { label: 'Cartão de Crédito', total: 978.01 },
      { label: 'Cartão de Débito', total: 229.09 },
      { label: 'PIX', total: 684.77 },
    ],
    cartoes: [
      { label: 'Elo Crédito', total: 117.59 },
      { label: 'Mastercard Crédito', total: 146.74 },
      { label: 'Visa Crédito', total: 713.68 },
      { label: 'Visa Débito', total: 229.09 },
    ],
    sangria: 0,
    suprimento: 0,
    dinheiroEsperado: 322.86,
    dinheiroContado: 322.86,
    diferenca: 0,
    paperWidthMm: mm,
  });
  const l = txt.split('\n');
  const cheias = l.filter((x) => x.length > 0);
  assert.ok(cheias.every((x) => x.length <= W), `[${mm}] nenhuma linha passa de ${W} colunas: ${cheias.find((x) => x.length > W)}`);
  assert.ok(l.some((x) => x.trim() === 'POSICAO DO CAIXA'), `[${mm}] título`);
  assert.ok(txt.includes('Gicelio Buery') && txt.includes('28/09/2026'), 'operador e data');
  const total = l.filter((x) => x.startsWith('TOTAL'));
  assert.equal(total.length, 3, `[${mm}] total do resumo, das vendas e dos cartões`);
  assert.ok(total.every((x) => x.length === W), `[${mm}] TOTAL alinhado à direita`);
  assert.ok(total[0].endsWith('2.214,73'), `resumo do caixa soma fundo + vendas: ${total[0]}`);
  assert.ok(total[1].endsWith('2.114,73'), `vendas do dia: ${total[1]}`);
  assert.ok(total[2].endsWith('1.207,10'), `cartões: ${total[2]}`);
  const din = l.find((x) => x.startsWith('Dinheiro no caixa'))!;
  assert.ok(din.endsWith('322,86') && din.length === W, `[${mm}] dinheiro no caixa: "${din}"`);
  assert.ok(l.some((x) => x.startsWith('Fundo de Caixa') && x.endsWith('100,00')), 'fundo de caixa');
}
// turno sem nenhuma venda: sem NaN, sem quebra
const vazio = buildCashClosingText({ storeName: 'Loja', operador: 'Ana', abertoEm: new Date(), fechadoEm: new Date(), fundo: 50, formas: [], cartoes: [], sangria: 0, suprimento: 0, dinheiroEsperado: 50, dinheiroContado: 45, diferenca: -5, paperWidthMm: 80 });
assert.ok(!vazio.includes('NaN') && !vazio.includes('undefined'), 'turno vazio sem NaN');
assert.ok(vazio.split('\n').some((x) => x.startsWith('Diferença') && x.endsWith('-5,00')), 'diferença negativa aparece');
console.log('ok');
