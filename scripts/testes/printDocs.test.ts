// rodar com: npx tsx scripts/testes/printDocs.test.ts
import assert from 'node:assert/strict';
import { impressoraRecebe, documentosPadrao } from '../../lib/printDocs';
assert.deepEqual(documentosPadrao('kitchen'), ['comanda']);
assert.deepEqual(documentosPadrao('bar'), ['comanda']);
assert.ok(documentosPadrao('receipt').includes('cupom_fiscal') && documentosPadrao('receipt').includes('pre_conta') && !documentosPadrao('receipt').includes('comanda'));
assert.equal(impressoraRecebe({ destination: 'receipt', documentos: null }, 'pre_conta'), true, 'padrão do caixa');
assert.equal(impressoraRecebe({ destination: 'bar', documentos: null }, 'pre_conta'), false, 'bar não recebe pré-conta por padrão');
assert.equal(impressoraRecebe({ destination: 'bar', documentos: ['comanda', 'pre_conta'] }, 'pre_conta'), true, 'bar configurado p/ pré-conta');
assert.equal(impressoraRecebe({ destination: 'bar', documentos: ['comanda', 'pre_conta'] }, 'comprovante'), false, 'só o que está marcado');
assert.equal(impressoraRecebe({ destination: 'receipt', documentos: ['cupom_fiscal'] }, 'pre_conta'), false, 'caixa sem pré-conta');
assert.equal(impressoraRecebe({ destination: 'all', documentos: null }, 'fechamento_caixa'), true);
assert.equal(impressoraRecebe({ destination: 'receipt', documentos: [] }, 'comprovante'), true, 'lista vazia = padrão (loja nunca fica sem imprimir)');
console.log('ok');
