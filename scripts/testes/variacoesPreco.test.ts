// rodar com: npx tsx scripts/testes/variacoesPreco.test.ts
import assert from 'node:assert/strict';
import { grupoViraVariacoes, validarVariacoes, variacoesParaGrupo, type Variacao } from '../../lib/variacoes';

const v = (name: string, price: string, omie = ''): Variacao => ({ tempId: name, name, price, omie_codigo: omie, available: true });

// preço de cada escolha → produto no preço da mais barata + acréscimo da diferença
const { precoBase, grupo } = variacoesParaGrupo('Moqueca ou Ensopado', [v('Moqueca', '159,90', '90193'), v('Ensopado', '149.90', '90108')]);
assert.equal(precoBase, 149.9);
assert.equal(grupo.required, true);
assert.equal(grupo.type, 'single');
assert.deepEqual(grupo.options.map((o) => [o.name, o.price_delta, o.omie_codigo]), [['Moqueca', 10, '90193'], ['Ensopado', 0, '90108']]);
// o cliente paga exatamente o preço de cada escolha
for (const o of grupo.options) assert.equal(Math.round((precoBase + o.price_delta) * 100) / 100, o.name === 'Moqueca' ? 159.9 : 149.9);

// ponto flutuante: 0.1 + 0.2 não vaza
assert.equal(variacoesParaGrupo('X', [v('A', '0.30'), v('B', '0.10')]).grupo.options[0].price_delta, 0.2);

// validação
assert.match(validarVariacoes([v('Só uma', '10')])!, /pelo menos 2/);
assert.match(validarVariacoes([v('A', ''), v('B', '10')])!, /preço da escolha "A"/);
assert.match(validarVariacoes([v('A', '10'), v('a', '12')])!, /repetida/);
assert.equal(validarVariacoes([v('A', '10'), v('B', '12'), v('', '')]), null, 'linha em branco é ignorada');

// leitura de produto já cadastrado (Camarão na Moqueca ou Ensopado: 169,90 e as duas escolhas a +0)
const lido = grupoViraVariacoes(169.9, { name: 'Estilo', type: 'single', required: true, options: [{ name: 'Ensopado', price_delta: '0.00', available: true, omie_codigo: '90106' }, { name: 'Moqueca', price_delta: 0, available: true, omie_codigo: '90192' }] });
assert.deepEqual(lido?.vars.map((x) => [x.name, x.price, x.omie_codigo]), [['Ensopado', '169.90', '90106'], ['Moqueca', '169.90', '90192']]);
// ida e volta não muda nada
const volta = variacoesParaGrupo(lido!.nome, lido!.vars);
assert.equal(volta.precoBase, 169.9);
assert.deepEqual(volta.grupo.options.map((o) => o.price_delta), [0, 0]);
// NÃO vira "escolhas com preço": opcional, múltipla, com preço por tamanho, acréscimo sem opção a R$ 0
const base = { name: 'g', type: 'single', required: true, options: [{ name: 'a', price_delta: 0, available: true }, { name: 'b', price_delta: 5, available: true }] };
assert.ok(grupoViraVariacoes(10, base));
assert.equal(grupoViraVariacoes(10, { ...base, required: false }), null);
assert.equal(grupoViraVariacoes(10, { ...base, type: 'multiple' }), null);
assert.equal(grupoViraVariacoes(10, { ...base, options: [{ name: 'a', price_delta: 3, available: true }, { name: 'b', price_delta: 5, available: true }] }), null);
assert.equal(grupoViraVariacoes(10, { ...base, options: [{ name: 'a', price_delta: 0, available: true, variants: { G: {} } }, { name: 'b', price_delta: 5, available: true }] }), null);
assert.equal(grupoViraVariacoes(10, undefined), null);
console.log('variacoesPreco: ok');
