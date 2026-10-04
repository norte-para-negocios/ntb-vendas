// rodar com: npx tsx scripts/testes/impressaoIdade.test.ts
import assert from 'node:assert/strict';
import { MAX_IDADE_AUTOIMPRESSAO_MIN, MAX_IDADE_AUTOIMPRESSAO_MS, podeImprimirAuto, avaliarIdadeAutoImpressao, particionarPorIdade } from '../../lib/impressaoIdade';

const MIN = 60 * 1000;
const agora = Date.parse('2026-10-04T16:00:00.000Z');
const criadoHa = (min: number) => new Date(agora - min * MIN).toISOString();

assert.equal(MAX_IDADE_AUTOIMPRESSAO_MIN, 60, 'teto é 60 minutos');
assert.equal(MAX_IDADE_AUTOIMPRESSAO_MS, 60 * MIN);

// Bordas: 59 e 60 minutos imprimem (não é MAIS velho que 60), 60min+1s e 61 não.
assert.equal(podeImprimirAuto(criadoHa(0), agora), true, 'agora');
assert.equal(podeImprimirAuto(criadoHa(59), agora), true, '59 min');
assert.equal(podeImprimirAuto(criadoHa(60), agora), true, '60 min exatos ainda imprime');
assert.equal(podeImprimirAuto(new Date(agora - 60 * MIN - 1000).toISOString(), agora), false, '60 min e 1 s');
assert.equal(podeImprimirAuto(criadoHa(61), agora), false, '61 min');
assert.equal(podeImprimirAuto(criadoHa(60 * 24), agora), false, 'pedido de ontem nunca imprime sozinho');

// Relógio do aparelho ADIANTADO 10 min: o servidor está 10 min atrás (offset -10min).
// Item criado há 55 min NO RELÓGIO DO SERVIDOR parece ter 65 min para o aparelho.
const aparelhoAdiantado = agora + 10 * MIN; // "agora" do aparelho
const criadoNoServidorHa55 = new Date(agora - 55 * MIN).toISOString();
assert.equal(podeImprimirAuto(criadoNoServidorHa55, aparelhoAdiantado), false, 'sem correção: parece velho');
assert.equal(podeImprimirAuto(criadoNoServidorHa55, aparelhoAdiantado, -10 * MIN), true, 'com offset do servidor: 55 min, imprime');

// Relógio ATRASADO 10 min (offset +10min): item de 65 min reais parece ter 55 pro aparelho.
const aparelhoAtrasado = agora - 10 * MIN;
const criadoServidorHa65 = new Date(agora - 65 * MIN).toISOString();
assert.equal(podeImprimirAuto(criadoServidorHa65, aparelhoAtrasado), true, 'sem correção: parece novo');
assert.equal(podeImprimirAuto(criadoServidorHa65, aparelhoAtrasado, 10 * MIN), false, 'com offset: 65 min, não imprime');

// created_at no futuro (aparelho atrasado e sem offset): é recente, imprime.
assert.equal(podeImprimirAuto(new Date(agora + 3 * MIN).toISOString(), agora), true, 'futuro próximo imprime');

// created_at inválido: NUNCA imprime sozinho e o motivo vem explícito (pra registrar).
for (const ruim of [undefined, null, '', 'lixo', 'NaN', 0 as any, {} as any]) {
  assert.equal(podeImprimirAuto(ruim as any, agora), false, `inválido: ${String(ruim)}`);
  assert.equal(avaliarIdadeAutoImpressao(ruim as any, agora).motivo, 'invalido');
}
// agora/offset inválidos: não adivinha, não imprime.
assert.equal(podeImprimirAuto(criadoHa(1), NaN), false, 'agora inválido');
assert.equal(podeImprimirAuto(criadoHa(1), agora, NaN), true, 'offset inválido é ignorado (0)');

const av = avaliarIdadeAutoImpressao(criadoHa(90), agora);
assert.deepEqual({ pode: av.pode, motivo: av.motivo, min: Math.round(av.idadeMs! / MIN) }, { pode: false, motivo: 'antigo', min: 90 });
assert.equal(avaliarIdadeAutoImpressao(criadoHa(5), agora).motivo, 'ok');

// Partição de lista: mantém a ordem dos recentes; antigos e inválidos separados.
const itens = [
  { id: 'a', created_at: criadoHa(5) },
  { id: 'b', created_at: criadoHa(300) },
  { id: 'c', created_at: 'xx' },
  { id: 'd', created_at: criadoHa(59) },
];
const p = particionarPorIdade(itens, agora);
assert.deepEqual(p.recentes.map((i) => i.id), ['a', 'd']);
assert.deepEqual(p.antigos.map((i) => i.id), ['b']);
assert.deepEqual(p.invalidos.map((i) => i.id), ['c']);

console.log('impressaoIdade: ok');
