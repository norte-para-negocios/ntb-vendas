// rodar com: npx tsx scripts/testes/impressaoAparelho.test.ts
// Onde cada papel sai, por computador (19/10/2026): notebook manda a comanda pro bar, PC do caixa pro caixa.
import assert from 'node:assert/strict';
import { escolherImpressorasDoAparelho, chaveDoPapel, lerImpressaoDoAparelho, salvarImpressaoDoAparelho } from '../../lib/impressaoAparelho';

const caixa = { id: 'p-caixa' };
const bar = { id: 'p-bar' };
const ativas = [caixa, bar];
const daLoja = [caixa]; // na loja, a comanda está marcada só no caixa

// Sem escolha no aparelho: regra da loja, como sempre.
assert.deepEqual(escolherImpressorasDoAparelho({}, 'pre_conta', ativas, daLoja), { impressoras: [caixa], doAparelho: false });
// Notebook escolheu o bar: sai no bar, não no caixa.
assert.deepEqual(escolherImpressorasDoAparelho({ pre_conta: ['p-bar'] }, 'pre_conta', ativas, daLoja), { impressoras: [bar], doAparelho: true });
// PC do caixa escolheu o caixa.
assert.deepEqual(escolherImpressorasDoAparelho({ pre_conta: ['p-caixa'] }, 'pre_conta', ativas, daLoja).impressoras, [caixa]);
// "Não imprimir neste computador".
assert.deepEqual(escolherImpressorasDoAparelho({ comprovante: [] }, 'comprovante', ativas, daLoja), { impressoras: [], doAparelho: true });
// Escolha aponta para impressora apagada/desativada: cai na regra da loja (papel nunca some calado).
assert.deepEqual(escolherImpressorasDoAparelho({ pre_conta: ['p-apagada'] }, 'pre_conta', ativas, daLoja), { impressoras: [caixa], doAparelho: false });
// Escolha de um papel não mexe nos outros.
assert.deepEqual(escolherImpressorasDoAparelho({ pre_conta: ['p-bar'] }, 'comprovante', ativas, daLoja).impressoras, [caixa]);
// Pedidos (papel do local de preparo) nunca seguem o aparelho.
assert.deepEqual(escolherImpressorasDoAparelho({ comanda: ['p-bar'] } as never, 'comanda', ativas, daLoja).impressoras, [caixa]);

// Chave anti-duplicata: manual e sem escolha = id da impressora (igual a antes).
assert.equal(chaveDoPapel('k', bar, 0, daLoja, false, true), 'k:p-bar');
assert.equal(chaveDoPapel('k', bar, 0, daLoja, true, false), 'k:p-bar');
// Comanda automática com escolha no aparelho: mesma chave que um aparelho sem escolha usaria, então o notebook (bar) e o
// PC do caixa (caixa) e o app antigo (loja) disputam a MESMA chave e a comanda sai uma vez só.
assert.equal(chaveDoPapel('k', bar, 0, daLoja, true, true), 'k:p-caixa');
assert.equal(chaveDoPapel('k', caixa, 0, daLoja, true, true), 'k:p-caixa');
assert.equal(chaveDoPapel('k', bar, 0, [], true, true), 'k:aparelho0');

// Guardado no aparelho, por loja.
const mem = new Map<string, string>();
(globalThis as { window?: unknown }).window = { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } } };
assert.deepEqual(lerImpressaoDoAparelho('loja1'), {});
salvarImpressaoDoAparelho('loja1', 'pre_conta', ['p-bar']);
salvarImpressaoDoAparelho('loja1', 'comprovante', []);
assert.deepEqual(lerImpressaoDoAparelho('loja1'), { pre_conta: ['p-bar'], comprovante: [] });
assert.deepEqual(lerImpressaoDoAparelho('loja2'), {}, 'outra loja não herda');
salvarImpressaoDoAparelho('loja1', 'pre_conta', null);
assert.deepEqual(lerImpressaoDoAparelho('loja1'), { comprovante: [] }, 'voltar para "igual à loja"');
mem.set('ntb-impressao-aparelho:loja3', '{lixo');
assert.deepEqual(lerImpressaoDoAparelho('loja3'), {}, 'armazenamento corrompido = igual à loja');

console.log('impressaoAparelho: ok');
