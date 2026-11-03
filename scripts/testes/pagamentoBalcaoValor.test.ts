// rodar com: npx tsx scripts/testes/pagamentoBalcaoValor.test.ts
import assert from 'node:assert/strict';
import { totalDosItens, conferirValorPago } from '../../lib/pagamentoValor';

// total do pedido: só itens não cancelados, 2 casas
assert.equal(totalDosItens([
  { quantity: 2, price_at_time: 10.1, status: 'pending' },
  { quantity: 1, price_at_time: 5, status: 'canceled' },
  { quantity: 3, price_at_time: 0.1, status: 'delivered' },
]), 20.5);
assert.equal(totalDosItens([]), 0);
assert.equal(totalDosItens(null), 0);

// pagou o total: ok
assert.equal(conferirValorPago({ total: 20.5, methods: [{ method: 'PIX', amount: 20.5 }] }, 20.5), null);
// diferença de arredondamento (até 1 centavo): ok
assert.equal(conferirValorPago({ total: 20.49, methods: [{ method: 'PIX', amount: 20.49 }] }, 20.5), null);
// total menor que o pedido: recusa
assert.match(conferirValorPago({ total: 1, methods: [{ method: 'PIX', amount: 1 }] }, 20.5) ?? '', /menor/);
// total certo mas soma das formas menor: recusa
assert.match(conferirValorPago({ total: 20.5, methods: [{ method: 'PIX', amount: 5 }] }, 20.5) ?? '', /menor/);
// várias formas somando o total: ok
assert.equal(conferirValorPago({ total: 20.5, methods: [{ method: 'PIX', amount: 10 }, { method: 'CASH', amount: 10.5 }] }, 20.5), null);
// taxa a mais (total maior que os itens): ok
assert.equal(conferirValorPago({ total: 22.55, methods: [{ method: 'CREDIT', amount: 22.55 }] }, 20.5), null);
// cortesia: não confere valor
assert.equal(conferirValorPago({ total: 0, methods: [{ method: 'COURTESY', amount: 0 }] }, 20.5), null);
// valores que não são número: recusa
assert.match(conferirValorPago({ total: Number.NaN, methods: [{ method: 'PIX', amount: 20.5 }] }, 20.5) ?? '', /menor/);

console.log('pagamentoBalcaoValor: ok');
