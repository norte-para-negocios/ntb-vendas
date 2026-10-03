// rodar com: npx tsx scripts/testes/cupomDesconto.test.ts
import assert from 'node:assert/strict';
import { calculateCouponDiscount } from '../../lib/coupons';
assert.equal(calculateCouponDiscount({ type: 'percent', value: 10 }, 100), 10);
assert.equal(calculateCouponDiscount({ type: 'fixed', value: 20 }, 100), 20);
assert.equal(calculateCouponDiscount({ type: 'fixed', value: 150 }, 100), 100);
assert.equal(calculateCouponDiscount({ type: 'percent', value: 100 }, 50), 50);
assert.equal(calculateCouponDiscount({ type: 'percent', value: 10 }, 0), 0);
console.log('cupomDesconto: ok');