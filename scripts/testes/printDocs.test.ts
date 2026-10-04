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
assert.equal(impressoraRecebe({ destination: 'receipt', documentos: [] }, 'comprovante'), true, 'lista vazia = padrão (loja nunca fica sem imprimir)');
// Achados da revisão: documento NOVO (fechamento de caixa) só sai onde foi marcado; o padrão antigo não muda.
assert.equal(impressoraRecebe({ destination: 'receipt', documentos: null }, 'fechamento_caixa'), false, 'fechamento só onde configurado (receipt)');
assert.equal(impressoraRecebe({ destination: 'all', documentos: null }, 'fechamento_caixa'), false, 'fechamento só onde configurado (all)');
assert.equal(impressoraRecebe({ destination: 'receipt', documentos: ['fechamento_caixa'] }, 'fechamento_caixa'), true, 'fechamento marcado');
assert.equal(impressoraRecebe({ destination: 'receipt', documentos: null }, 'pre_conta', { soConfigurado: true }), false, 'pré-conta automática exige marca explícita');
assert.equal(impressoraRecebe({ destination: 'bar', documentos: ['comanda', 'pre_conta'] }, 'pre_conta', { soConfigurado: true }), true, 'pré-conta automática no bar configurado');
assert.equal(impressoraRecebe({ destination: 'receipt', documentos: null }, 'pre_conta'), true, 'conferência manual segue no caixa (padrão antigo)');
console.log('ok');

// Vocabulário do dono (04/10/2026): PEDIDO = papel do local de preparo; COMANDA = a conta com preços ao cliente.
// Só os rótulos mudam; os ids guardados em printer_configs.documentos continuam 'comanda' e 'pre_conta'.
import { DOCS_IMPRESSAO, impressorasDoDoc, rotuloDoc } from '../../lib/printDocs';
assert.equal(rotuloDoc('comanda'), 'Pedidos');
assert.equal(rotuloDoc('pre_conta'), 'Comanda (conta do cliente)');
assert.ok(DOCS_IMPRESSAO.every((d) => !/pré-conta/i.test(d.rotulo) && !/Comanda \(pedidos\)/i.test(d.rotulo)), 'sem os rótulos antigos');
assert.deepEqual(DOCS_IMPRESSAO.map((d) => d.id), ['comanda', 'pre_conta', 'comprovante', 'cupom_fiscal', 'fechamento_caixa'], 'ids de armazenamento intactos');
const imps = [
  { name: 'Cozinha', destination: 'kitchen', is_active: true, documentos: null },
  { name: 'Bar', destination: 'bar', is_active: true, documentos: ['comanda', 'pre_conta'] },
  { name: 'Caixa', destination: 'receipt', is_active: true, documentos: null },
  { name: 'Velha', destination: 'bar', is_active: false, documentos: ['comanda', 'pre_conta'] },
];
assert.deepEqual(impressorasDoDoc(imps, 'comanda').map((p) => p.name), ['Cozinha', 'Bar'], 'Pedidos: kitchen/bar, ativas');
assert.deepEqual(impressorasDoDoc(imps, 'pre_conta').map((p) => p.name), ['Bar', 'Caixa'], 'Comanda: padrão do caixa + marcadas');
assert.deepEqual(impressorasDoDoc(imps, 'pre_conta', { soConfigurado: true }).map((p) => p.name), ['Bar'], 'Comanda automática: só as marcadas');
console.log('printDocs vocabulário: ok');
