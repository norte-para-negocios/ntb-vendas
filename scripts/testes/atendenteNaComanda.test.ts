// rodar com: npx tsx scripts/testes/atendenteNaComanda.test.ts
// 20/10/2026 (ODARA): o nome de quem lançou saía como "Cliente: X" embaixo de cada item. Agora: uma vez só, no fim.
import assert from 'node:assert/strict';
import { buildBillReceiptText } from '../../lib/print';

const base = { storeName: 'ODARA BEACH', label: 'MESA 5', subtotal: 79.9, total: 79.9, paperWidthMm: 80 };
const uma = buildBillReceiptText({ ...base, items: [
  { quantity: 1, name: 'Cerveja Petra 600ml', total: 20, client: 'Talislane Silva', porEquipe: true },
  { quantity: 1, name: 'Casquinha de Siri', total: 39.9, client: 'Talislane Silva', porEquipe: true },
  { quantity: 1, name: 'Cerveja Petra 600ml', total: 20, client: 'Talislane Silva', porEquipe: true },
] });
assert.ok(!uma.includes('Cliente:'), 'nome da equipe não sai como Cliente');
assert.equal(uma.split('\n').filter((l) => l.includes('Talislane Silva')).length, 1, 'nome sai uma vez só');
assert.ok(uma.includes('Atendente: Talislane Silva'));
assert.ok(uma.indexOf('Atendente:') > uma.indexOf('Casquinha de Siri') && uma.indexOf('Atendente:') < uma.indexOf('TOTAL'), 'no fim dos itens, antes do total');

const duas = buildBillReceiptText({ ...base, items: [
  { quantity: 1, name: 'Água', total: 5, client: 'Gessica Gomes', porEquipe: true },
  { quantity: 1, name: 'Suco', total: 9, client: 'Talislane Silva', porEquipe: true },
  { quantity: 1, name: 'Água', total: 5, client: 'Gessica Gomes', porEquipe: true },
] });
assert.ok(duas.includes('Atendentes: Gessica Gomes, Talislane Silva'));

// Nome digitado pelo cliente no QR continua por item; sem nada da equipe, nenhuma linha de atendente.
const qr = buildBillReceiptText({ ...base, items: [{ quantity: 1, name: 'Água', total: 5, client: 'Ana' }] });
assert.ok(qr.includes('Cliente: Ana') && !qr.includes('Atendente'));

console.log('atendenteNaComanda: ok');
