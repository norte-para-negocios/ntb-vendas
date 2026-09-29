// rodar com: npx tsx scripts/testes/layoutComanda.test.ts
import assert from 'node:assert/strict';
import { buildBillReceiptText, buildKitchenTicketText } from '../../lib/print';

for (const [mm, W] of [[80, 48], [58, 32]] as const) {
  // ---------- CONTA / PRÉ-NOTA ----------
  const conta = buildBillReceiptText({
    storeName: 'O Sertão Vai Virar Mar - Restaurante e Petiscaria Ltda',
    cnpj: '39.912.717/0001-45',
    label: 'MESA 4',
    items: [
      { quantity: 1, name: 'Queijo Coalho (250g)', total: 42.9 },
      { quantity: 2, name: 'Pizza Tradicional Grande com Borda Recheada de Catupiry', total: 179.8, client: 'Ana' },
      { quantity: 3, name: 'Água', total: 17.7 },
    ],
    subtotal: 240.4,
    serviceFee: { charged: true, rate: 0.1, amount: 24.04, removedForTable: false },
    total: 264.44,
    payment: { methods: [{ method: 'CASH', amount: 270 }], changeDue: 5.56 },
    paperWidthMm: mm,
  });
  const l = conta.split('\n');
  const cheias = l.filter((x) => x.length > 0);
  assert.ok(cheias.every((x) => x.length <= W), `[${mm}] nenhuma linha passa de ${W} colunas: ${cheias.find((x) => x.length > W)}`);
  assert.ok(l.filter((x) => x === '='.repeat(W)).length >= 3, `[${mm}] blocos separados por linha dupla`);
  assert.ok(l.some((x) => x === '-'.repeat(W)), `[${mm}] linhas simples de separação`);
  assert.ok(l.some((x) => /^QTD\s+ITEM\s+VALOR$/.test(x) && x.length === W), `[${mm}] cabeçalho de colunas alinhado`);
  const linhaQueijo = l.find((x) => x.includes('Queijo Coalho'))!;
  assert.ok(linhaQueijo.startsWith('1x') && linhaQueijo.endsWith('42,90') && linhaQueijo.length === W, `[${mm}] item com valor à direita: "${linhaQueijo}"`);
  const pizza = l.findIndex((x) => x.startsWith('2x'));
  assert.ok(l[pizza].endsWith('179,80') && l[pizza].length === W, `[${mm}] valor só na primeira linha do item longo`);
  assert.ok(l[pizza + 1].startsWith('    ') && !/\d,\d\d$/.test(l[pizza + 1]), `[${mm}] continuação do nome indentada, sem valor`);
  assert.ok(conta.includes('Cliente: Ana'), 'cliente do item');
  const total = l.find((x) => x.startsWith('TOTAL'))!;
  assert.ok(total.endsWith('R$ 264,44') && total.length === W, `[${mm}] TOTAL alinhado à direita: "${total}"`);
  const sub = l.find((x) => x.startsWith('Subtotal'))!;
  assert.ok(sub.endsWith('R$ 240,40') && sub.length === W, `[${mm}] subtotal alinhado`);
  assert.ok(l.some((x) => x.startsWith('Dinheiro') && x.endsWith('R$ 270,00')), `[${mm}] forma de pagamento à direita`);
  assert.ok(l.some((x) => x.startsWith('Troco') && x.endsWith('R$ 5,56')), `[${mm}] troco`);
  assert.ok(conta.includes('SEM VALOR FISCAL'), 'aviso de que não é nota');
  assert.ok(conta.includes('CNPJ: 39.912.717/0001-45'), 'cnpj');
  assert.ok(conta.includes('MESA 4'), 'mesa');

  // ---------- COMANDA (cozinha) ----------
  const cozinha = buildKitchenTicketText({
    kind: 'COZINHA', storeName: 'O Sertão Vai Virar Mar', orderType: 'MESA', identifier: 'MESA 4', client: 'Ana', orderIdShort: 'abc12345', paperWidthMm: mm,
    items: [
      { quantity: 2, productName: 'Pizza Tradicional Grande com Borda Recheada de Catupiry', addons: 'Borda: Catupiry', observation: 'sem cebola' },
      { quantity: 1, productName: 'Coxinha' },
    ],
  });
  const k = cozinha.split('\n');
  assert.ok(k.filter((x) => x.length > 0).every((x) => x.length <= W), `[${mm}] comanda cabe em ${W} colunas`);
  assert.ok(k.filter((x) => x === '='.repeat(W)).length >= 2, `[${mm}] comanda com linhas duplas`);
  const titulo = k.find((x) => x.trim() === 'COZINHA')!;
  assert.ok(titulo && titulo.startsWith(' '), `[${mm}] título centralizado`);
  assert.ok(k.some((x) => x.startsWith('MESA 4')), 'mesa em destaque');
  assert.ok(cozinha.includes('Cliente: Ana'));
  const iPizza = k.findIndex((x) => x.startsWith('2x'));
  const iCox = k.findIndex((x) => x.startsWith('1x'));
  assert.ok(iPizza >= 0 && iCox > iPizza, `[${mm}] itens em ordem`);
  assert.ok(k.slice(iPizza, iCox).some((x) => x === '-'.repeat(W)), `[${mm}] linha separando um item do outro`);
  assert.ok(k.some((x) => x.trim().startsWith('+ Borda: Catupiry')) && k.some((x) => x.trim() === 'OBS: SEM CEBOLA'), 'adicional e observação em linhas próprias');
  assert.ok(cozinha.includes('Pedido #abc12345'));
}
// ---------- título do setor (pizzaria imprime "PIZZARIA", não "COZINHA") ----------
{
  const base = { kind: 'COZINHA' as const, storeName: 'Loja', orderType: 'MESA', identifier: 'MESA 2', orderIdShort: 'abc12345', paperWidthMm: 80, items: [{ quantity: 2, productName: 'Pizza Tradicional' }] };
  const pizzaria = buildKitchenTicketText({ ...base, titulo: 'PIZZARIA' }).split('\n');
  assert.ok(pizzaria.some((x) => x.trim() === 'PIZZARIA'), 'cabeçalho do setor');
  assert.ok(!pizzaria.some((x) => x.trim() === 'COZINHA'), 'não diz COZINHA na pizzaria');
  const canc = buildKitchenTicketText({ ...base, titulo: 'PIZZARIA', cancelamento: { por: 'Ramon' } });
  assert.ok(canc.includes('CANCELAMENTO - PIZZARIA'), 'cancelamento também usa o setor');
  assert.ok(buildKitchenTicketText(base).split('\n').some((x) => x.trim() === 'COZINHA'), 'sem título continua COZINHA');
}
console.log('ok');
