// rodar com: npx tsx scripts/testes/taxaEditavel.test.ts
// Taxa de serviço editável pelo caixa (migration 141, pedido do Ramon 2026-10-01).
// Mesmas regras do servidor (add_fee_item_secure); o servidor é testado ao vivo na loja ZZ.
import assert from 'node:assert/strict';
import {
  resolverTaxaEditada, resolverValorTaxaFixa, taxaPercentualDesatualizada,
  baseDaTaxaPercentual, contaTemTaxaPercentual, valorTaxaPercentual,
} from '../../lib/taxas';

const pizza = { quantity: 1, price_at_time: 74.9, status: 'delivered', product: { fee_type: null } };
const agua = { quantity: 2, price_at_time: 5.4, status: 'delivered', product: { fee_type: null } };
const cancelado = { quantity: 1, price_at_time: 100, status: 'canceled', product: { fee_type: null } };
const taxaProd = { fee_type: 'percent', fee_percent: 10 };
const conta = [pizza, agua, cancelado]; // base 85.70
const base = baseDaTaxaPercentual(conta);
assert.equal(Math.round(base * 100) / 100, 85.7, 'base ignora cancelado');

// valor digitado: grava exatamente o valor (25 de taxa, cliente paga 20)
let r = resolverTaxaEditada(250, { valor: 20 });
assert.ok(r.ok && r.valor === 20 && r.percent === null && !r.semTaxa);
// percentual menor e maior que 10
r = resolverTaxaEditada(85.7, { percent: 15 });
assert.ok(r.ok && r.valor === 12.86 && r.percent === 15, 'meio centavo sobe como no Postgres (12.855 -> 12.86)');
r = resolverTaxaEditada(85.7, { percent: 5 });
assert.ok(r.ok && r.valor === 4.29);
r = resolverTaxaEditada(100, { percent: 11 });
assert.ok(r.ok && r.valor === 11);

// zero = sem taxa
r = resolverTaxaEditada(85.7, { valor: 0 });
assert.ok(r.ok && r.semTaxa);
r = resolverTaxaEditada(85.7, { percent: 0 });
assert.ok(r.ok && r.semTaxa);

// limites
assert.equal(resolverTaxaEditada(85.7, { valor: -1 }).ok, false, 'negativo');
assert.equal(resolverTaxaEditada(85.7, { valor: 85.71 }).ok, false, 'maior que a conta');
assert.ok(resolverTaxaEditada(85.7, { valor: 85.7 }).ok, 'igual à conta passa');
assert.equal(resolverTaxaEditada(85.7, { percent: 101 }).ok, false, 'teto 100%');
assert.ok(resolverTaxaEditada(85.7, { percent: 100 }).ok);
assert.equal(resolverTaxaEditada(85.7, { percent: -5 }).ok, false);
assert.equal(resolverTaxaEditada(85.7, { valor: 5, percent: 5 }).ok, false, 'os dois ao mesmo tempo');
assert.equal(resolverTaxaEditada(85.7, {}).ok, false, 'nenhum dos dois');
assert.equal(resolverTaxaEditada(85.7, { valor: NaN }).ok, false);
assert.equal(resolverTaxaEditada(0, { valor: 5 }).ok, false, 'conta sem itens não comporta taxa');

// taxa fixa (rolha cobrada diferente)
assert.ok(resolverValorTaxaFixa(45).ok);
assert.equal(resolverValorTaxaFixa(0).ok, false);
assert.equal(resolverValorTaxaFixa(5000.01).ok, false);
assert.equal(resolverValorTaxaFixa(NaN).ok, false);

// anti-cobrança dupla: item de taxa (editado ou não) = automático não soma
const itemPadrao = { quantity: 1, price_at_time: 8.57, status: 'delivered', product: taxaProd };
const itemEditadoValor = { ...itemPadrao, price_at_time: 6, fee_manual: true, fee_manual_percent: null };
const itemEditadoPct = { ...itemPadrao, price_at_time: 12.86, fee_manual: true, fee_manual_percent: 15 };
assert.equal(contaTemTaxaPercentual(conta), false);
for (const it of [itemPadrao, itemEditadoValor, itemEditadoPct]) assert.equal(contaTemTaxaPercentual([...conta, it]), true);
// item cancelado não conta
assert.equal(contaTemTaxaPercentual([...conta, { ...itemPadrao, status: 'canceled' }]), false);
// a taxa não entra na base dela mesma (anti-duplicação do cálculo)
assert.equal(baseDaTaxaPercentual([...conta, itemEditadoValor]), base);

// recálculo automático quando entra item novo
const novo = { quantity: 1, price_at_time: 5.4, status: 'delivered', product: { fee_type: null } };
assert.equal(taxaPercentualDesatualizada([...conta, itemPadrao]), null, 'padrão atualizado');
const velhaPadrao = taxaPercentualDesatualizada([...conta, novo, itemPadrao]);
assert.ok(velhaPadrao && velhaPadrao.esperado === valorTaxaPercentual([...conta, novo], 10), 'padrão recalcula com 10%');
assert.equal(taxaPercentualDesatualizada([...conta, novo, itemEditadoValor]), null, 'valor digitado em R$ nunca é sobrescrito');
const velhaPct = taxaPercentualDesatualizada([...conta, novo, itemEditadoPct]);
assert.ok(velhaPct && velhaPct.esperado === valorTaxaPercentual([...conta, novo], 15), 'percentual digitado recalcula com o digitado (15), não com 10');
assert.equal(taxaPercentualDesatualizada(conta), null, 'sem taxa lançada nada a recalcular');
console.log('ok');
