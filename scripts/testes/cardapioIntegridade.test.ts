// rodar com: npx tsx scripts/testes/cardapioIntegridade.test.ts
import assert from 'node:assert/strict';
import { auditarCardapio } from '../../lib/cardapioIntegridade';

const cats = [{ id: 'c1', name: 'Drinks' }, { id: 'c2', name: 'Vazia' }];
const prods: any[] = [
  { id: 'p1', name: 'Caipirinha', price: 24.9, category_id: 'c1', available: true, order: 1, omie_codigo: '90001' },
  { id: 'p2', name: 'Caipirinha', price: 24.9, category_id: 'c1', available: true, order: 2, omie_codigo: '90002' },   // nome duplicado
  { id: 'p3', name: 'Órfão', price: 10, category_id: null, available: true, order: 3, omie_codigo: '90003' },        // sem categoria
  { id: 'p4', name: 'Grátis', price: 0, category_id: 'c1', available: true, order: 4, omie_codigo: '90004' },        // preço zero
  { id: 'p5', name: 'Oculto sem categoria', price: 10, category_id: null, available: false },                          // inativo: ignora
  { id: 'p6', name: 'Com grupo vazio', price: 30, category_id: 'c1', available: true, order: 5, omie_codigo: '90006', grupos: [{ name: 'Tamanho', required: true, opcoes: 0 }] },
  { id: 'p7', name: 'Mesma ordem', price: 5, category_id: 'c1', available: true, order: 5, omie_codigo: '90007' },     // ordem repetida
  { id: 'p8', name: 'Taxa', price: 0, category_id: 'c1', available: true, fee_type: 'percent', order: 6 },            // taxa: preço 0 é normal
  { id: 'p9', name: 'Sem código', price: 12, category_id: 'c1', available: true, order: 7 },                           // sem código Omie
];
const r = auditarCardapio({ categorias: cats, produtos: prods });
assert.ok(r.some((a) => a.tipo === 'sem_categoria' && a.texto.includes('Órfão')), 'produto sem categoria');
assert.ok(!r.some((a) => a.texto.includes('Oculto sem categoria')), 'inativo não entra');
assert.ok(r.some((a) => a.tipo === 'categoria_vazia' && a.texto.includes('Vazia')), 'categoria sem produto ativo');
assert.ok(r.some((a) => a.tipo === 'preco_zero' && a.texto.includes('Grátis')), 'preço zero');
assert.ok(!r.some((a) => a.tipo === 'preco_zero' && a.texto.includes('Taxa')), 'taxa com preço 0 é normal');
assert.ok(r.some((a) => a.tipo === 'nome_duplicado' && a.texto.includes('Caipirinha')), 'nome duplicado');
assert.ok(r.some((a) => a.tipo === 'grupo_obrigatorio_vazio' && a.severidade === 'alta'), 'grupo obrigatório sem opção bloqueia a venda');
assert.ok(r.some((a) => a.tipo === 'ordem_repetida'), 'duas posições iguais na mesma categoria');
assert.ok(r.some((a) => a.tipo === 'sem_codigo_omie' && a.texto.includes('Sem código')), 'sem código Omie');
assert.ok(!r.some((a) => a.tipo === 'sem_codigo_omie' && (a.texto.includes('Taxa') || a.texto.includes('Com grupo vazio'))), 'taxa e produto com grupo não pedem código');
assert.deepEqual(auditarCardapio({ categorias: [], produtos: [] }), []);
// grupos: código nas opções dispensa o código no produto; sem código em lugar nenhum acusa
const g = auditarCardapio({ categorias: [{ id: 'c1', name: 'X', order: 1 }, { id: 'c2', name: 'Y', order: 1 }], produtos: [
  { id: 'a', name: 'Pizza', price: 50, category_id: 'c1', available: true, order: 1, grupos: [{ name: 'Sabor', required: true, opcoes: 3, temCodigoOmie: true }] },
  { id: 'b', name: 'Combo', price: 50, category_id: 'c1', available: true, order: 2, grupos: [{ name: 'Item', required: false, opcoes: 2, temCodigoOmie: false }] },
  { id: 'c', name: 'Sem posição', price: 5, category_id: 'c1', available: true, omie_codigo: '1' },
] as any });
assert.ok(!g.some((a) => a.tipo === 'sem_codigo_omie' && a.texto.includes('Pizza')), 'código nas opções basta');
assert.ok(g.some((a) => a.tipo === 'sem_codigo_omie' && a.texto.includes('Combo')), 'grupo sem código nenhum acusa');
assert.ok(g.some((a) => a.tipo === 'sem_posicao' && a.texto.includes('Sem posição')), 'produto sem posição');
assert.ok(g.some((a) => a.tipo === 'ordem_repetida' && a.texto.includes('Categorias')), 'categorias na mesma posição');
// Ordenação: alta antes de média antes de baixa
const sev = r.map((a) => a.severidade);
assert.deepEqual(sev, [...sev].sort((a, b) => ({ alta: 0, media: 1, baixa: 2 }[a] - { alta: 0, media: 1, baixa: 2 }[b])), 'achados ordenados por gravidade');
// loja sem nenhum código: um aviso só
const sem = auditarCardapio({ categorias: [{ id: 'c', name: 'C' }], produtos: [1, 2, 3].map((n) => ({ id: String(n), name: 'P' + n, price: 5, category_id: 'c', available: true, order: n })) as any });
assert.equal(sem.filter((a) => a.tipo === 'sem_codigo_omie').length, 1, 'loja sem integração: um aviso agregado');
// integração com o Estoque LIGADA mas nenhum produto vinculado: não é detalhe, é a loja que acha que baixa estoque e não baixa
const ligada = auditarCardapio({ categorias: [{ id: 'c', name: 'C' }], produtos: [1, 2, 3].map((n) => ({ id: String(n), name: 'P' + n, price: 5, category_id: 'c', available: true, order: n })) as any }, { integracaoLigada: true });
const aviso = ligada.filter((a) => a.tipo === 'sem_codigo_omie');
assert.equal(aviso.length, 1, 'um aviso só');
assert.equal(aviso[0].severidade, 'alta', 'com integração ligada é alerta alto');
assert.match(aviso[0].texto, /integração com o Estoque está ligada/i);
assert.match(aviso[0].texto, /nenhuma venda/i);
assert.equal(ligada[0].tipo, 'sem_codigo_omie', 'vem primeiro (alta)');
// integração ligada e a loja JÁ tem produtos vinculados: continua um aviso por produto que falta (média)
const parcial = auditarCardapio({ categorias: [{ id: 'c', name: 'C' }], produtos: [{ id: '1', name: 'A', price: 5, category_id: 'c', available: true, order: 1, omie_codigo: '9' }, { id: '2', name: 'B', price: 5, category_id: 'c', available: true, order: 2 }] as any }, { integracaoLigada: true });
assert.equal(parcial.filter((a) => a.tipo === 'sem_codigo_omie' && a.severidade === 'media').length, 1);
// integração desligada: continua o aviso baixo de sempre
assert.equal(auditarCardapio({ categorias: [{ id: 'c', name: 'C' }], produtos: [1].map((n) => ({ id: String(n), name: 'P' + n, price: 5, category_id: 'c', available: true, order: n })) as any }, { integracaoLigada: false }).find((a) => a.tipo === 'sem_codigo_omie')?.severidade, 'baixa');
console.log('cardapioIntegridade: ok');
