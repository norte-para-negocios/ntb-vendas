// rodar com: npx tsx scripts/testes/relatorioEquipeHtml.test.ts
import assert from 'node:assert/strict';
import { buildEquipeHtml, buildPessoaHtml, duracao } from '../../lib/reports/relatorioEquipeHtml';
import type { Pessoa } from '../../lib/reports/analiseEquipe';

assert.equal(duracao(0), '—');
assert.equal(duracao(45), '45 min');
assert.equal(duracao(150), '2h30');
assert.equal(duracao(120), '2h');

const p: Pessoa = {
  nome: 'Herica <Caixa>', papel: 'cashier',
  lancou: { itens: 4, valor: 125, contas: 1, mesas: 1, porHora: new Array(24).fill(0), produtos: [{ nome: 'Moqueca', qtd: 1, total: 100 }], categorias: [{ nome: 'Pratos', total: 100 }] },
  recebeu: { contas: 3, valor: 480.5, porForma: [{ chave: 'PIX', rotulo: 'Pix', total: 480.5 }] },
  excecoes: { total: 1, cancelados: { qtd: 1, valor: 8 }, porTipo: { item_cancelado: 1 } },
  login: { entradas: 2, minutos: 150, primeiro: '2026-10-24T10:00:00Z', ultimo: '2026-10-24T12:30:00Z' },
  preContas: 4, mesasTrocadas: 1, mesasAbertas: 6, ponto: { minutos: 0 },
};
const meta = { loja: 'ODARA', periodoLabel: '24/10/2026', geradoEm: new Date('2026-10-25T12:00:00Z'), geradoPor: 'Dono' };
const linha = [{ quando: '2026-10-24T13:10:00Z', tipo: 'lancou' as const, texto: 'Lançou 2× Cerveja · Mesa 12', valor: 20 }];

const h = buildPessoaHtml(p, linha, meta);
assert.ok(h.includes('Herica &lt;Caixa&gt;')); // escapado
assert.ok(h.includes('Lançou') && h.includes('Recebeu'));
assert.ok(h.includes('2h30'));
assert.ok(h.includes('Lançou 2× Cerveja · Mesa 12'));
assert.ok(h.includes('Moqueca'));
assert.ok(h.includes('Pix'));
assert.ok(h.includes('Caixa')); // função

const e = buildEquipeHtml([p], meta);
assert.ok(e.includes('Recebeu'));
assert.ok(e.includes('Tempo logado'));
assert.ok(e.includes('R$ 480,50'));

console.log('relatorioEquipeHtml: ok');
