import assert from 'node:assert/strict';
import { vendaDoLink } from '../../lib/linkVenda';

const id = '48c88322-7dbc-4332-9c7a-79bf9cb8e93d';
assert.equal(vendaDoLink(`?venda=${id}`), id);
assert.equal(vendaDoLink(`venda=${id.toUpperCase()}&x=1`), id);
assert.equal(vendaDoLink('?venda=abc'), null);
assert.equal(vendaDoLink(''), null);
assert.equal(vendaDoLink(null), null);
assert.equal(vendaDoLink('?outra=1'), null);
console.log('linkVenda: ok');
