// rodar com: npx tsx scripts/testes/estoqueConexao.test.ts
// "Testar conexão" da aba Integrações: o que o Vendas conclui a partir das duas leituras inofensivas ao Estoque.
import assert from 'node:assert/strict';
import { resumirConexao } from '../../lib/estoqueConexao';

const ok = (locais: unknown[] = [{ codigo: 1 }, { codigo: 2 }]) => ({ status: 200, json: { locais } });

// Estoque novo, loja de teste (simulada): conecta, mas avisa que nada vai para o Omie real.
let r = resumirConexao(ok(), { status: 200, json: { nome: 'Loja X [TESTE]', simulada: true, omieReal: false, versao: '2' } });
assert.equal(r.estado, 'ok');
assert.equal(r.simulada, true);
assert.equal(r.nome, 'Loja X [TESTE]');
assert.equal(r.versaoAntiga, false);
assert.equal(r.locais, 2);

// Estoque novo, loja real com chave do Omie.
r = resumirConexao(ok(), { status: 200, json: { nome: 'Sertão', simulada: false, omieReal: true } });
assert.equal(r.estado, 'ok');
assert.equal(r.simulada, false);
assert.equal(r.omieReal, true);

// Loja real mas sem chave do Omie: conecta, porém nada chega ao Omie.
r = resumirConexao(ok(), { status: 200, json: { nome: 'Loja', simulada: false, omieReal: false } });
assert.equal(r.estado, 'ok');
assert.equal(r.omieReal, false);
assert.match(r.mensagem, /chave do Omie/i);

// Estoque antigo (sem /status): a chave responde, mas não dá para saber se é teste.
r = resumirConexao(ok(), { status: 404 });
assert.equal(r.estado, 'ok');
assert.equal(r.versaoAntiga, true);
assert.equal(r.simulada, null);
assert.match(r.mensagem, /versão antiga do Estoque, não sei se é teste/);
// /status fora do ar ou com erro também não derruba o teste.
assert.equal(resumirConexao(ok(), null).versaoAntiga, true);
assert.equal(resumirConexao(ok(), { status: 500 }).estado, 'ok');

// Chave errada.
r = resumirConexao({ status: 401, json: { error: 'Chave de integração inválida' } }, null);
assert.equal(r.estado, 'chave_invalida');
assert.match(r.mensagem, /chave/i);
// Estoque fora do ar / URL errada / erro do servidor.
assert.equal(resumirConexao({ status: null, erroRede: 'ECONNREFUSED' }, null).estado, 'fora_do_ar');
assert.equal(resumirConexao({ status: 404 }, null).estado, 'url_errada');
assert.equal(resumirConexao({ status: 500, json: { error: 'x' } }, null).estado, 'erro_estoque');
// 200 sem a lista de locais não é uma resposta do Estoque.
assert.equal(resumirConexao({ status: 200, json: { qualquer: 1 } }, null).estado, 'url_errada');
console.log('ok');
