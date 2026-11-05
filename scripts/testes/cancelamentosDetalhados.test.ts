// rodar com: npx tsx scripts/testes/cancelamentosDetalhados.test.ts
import assert from 'node:assert/strict';
import { localDoCancelamento, minutosAteCancelar, filtrarCancelamentos, resumoCancelamentos, statusAnteriorLabel, linhasCsvCancelamentos, type Cancelamento } from '../../lib/cancelamentosDetalhados';

const base: Cancelamento = {
  id: '1', cancelado_em: '2026-11-04T23:10:00Z', pedido_em: '2026-11-04T22:40:00Z', produto: 'Caipirinha', quantidade: 2, valor: 49.8,
  motivo: 'Cliente desistiu', autorizado_por: 'Claudia', cancelado_por: 'João', sem_senha: false, parcial: false,
  status_anterior: 'preparing', tipo: 'table', mesa: 12, cliente: null, lancado_por: 'João', lancado_papel: 'garcom', setor: 'Bar',
};
const balcao: Cancelamento = { ...base, id: '2', tipo: 'counter', mesa: null, cliente: 'Ana', motivo: 'Erro de lançamento', valor: 10, autorizado_por: null, sem_senha: true, cancelado_por: 'Maria', setor: 'Cozinha' };
const antigo: Cancelamento = { ...base, id: '3', tipo: null, mesa: null, pedido_em: null, setor: null, motivo: null, cancelado_por: 'Claudia' };

assert.equal(localDoCancelamento(base), 'Mesa 12');
assert.equal(localDoCancelamento(balcao), 'Balcão · Ana');
assert.equal(localDoCancelamento({ ...balcao, cliente: null }), 'Balcão');
assert.equal(localDoCancelamento(antigo), 'Não registrado');
assert.equal(minutosAteCancelar(base), 30);
assert.equal(minutosAteCancelar(antigo), null);
assert.equal(statusAnteriorLabel('preparing'), 'Em preparo');
assert.equal(statusAnteriorLabel('pending'), 'Ainda não preparado');
assert.equal(statusAnteriorLabel('delivered'), 'Já entregue');
assert.equal(statusAnteriorLabel(null), '—');

const todos = [base, balcao, antigo];
assert.deepEqual(filtrarCancelamentos(todos, { local: 'balcao' }).map((c) => c.id), ['2']);
assert.deepEqual(filtrarCancelamentos(todos, { local: 'mesa' }).map((c) => c.id), ['1']);
assert.deepEqual(filtrarCancelamentos(todos, { pessoa: 'claudia' }).map((c) => c.id), ['1', '3']);
assert.deepEqual(filtrarCancelamentos(todos, { busca: 'caipi', motivo: 'Cliente desistiu' }).map((c) => c.id), ['1']);
assert.deepEqual(filtrarCancelamentos(todos, { setor: 'Cozinha' }).map((c) => c.id), ['2']);

const r = resumoCancelamentos(todos);
assert.equal(r.quantidade, 3);
assert.equal(Math.round(r.valor * 100), Math.round((49.8 + 10 + 49.8) * 100));
assert.deepEqual(r.porMotivo[0], { nome: 'Cliente desistiu', quantidade: 1, valor: 49.8 });
assert.equal(r.porMotivo.find((m) => m.nome === 'Sem motivo')?.quantidade, 1);
assert.equal(r.porPessoa[0].nome, 'Claudia');
assert.equal(r.semSenha, 1);

const csv = linhasCsvCancelamentos([balcao]);
assert.equal(csv[0][0], 'Cancelado em');
assert.equal(csv[1][2], 'Balcão · Ana');
assert.equal(csv[1][6], '10,00');
console.log('cancelamentosDetalhados: ok');
