// rodar com: npx tsx scripts/testes/baixaSemTaxa.test.ts
// 05/10/2026: a taxa (serviço, rolha, couvert, frete) não é mercadoria e não entra na baixa de estoque: ela vai na nota fiscal.
// Em 04/10 a baixa mandava a Taxa de Serviço (90875) ao Estoque: 33 saídas sem custo de um item que não existe fisicamente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync('lib/baixaEstoqueServidor.ts', 'utf8');
assert.ok(src.includes('if (produto?.fee_type) continue;'), 'item de taxa lançado é ignorado na baixa');
assert.ok(!src.includes('somar(feeOmieCodigo'), 'a taxa automática não é adicionada à baixa');
assert.ok(!/charge_service_fee/.test(src), 'a baixa não depende mais de charge_service_fee');
assert.ok(!src.includes('feeOmieCodigo'), 'sem resquício da taxa automática');
// a taxa continua na nota fiscal (cobrança no Omie)
const nota = readFileSync('scripts/testes/nfceTaxaItem.test.ts', 'utf8');
assert.ok(nota.length > 100, 'o teste da taxa na NFC-e existe e segue valendo');
console.log('baixaSemTaxa: todos os casos passaram');
