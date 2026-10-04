// rodar com: npx tsx scripts/testes/taxaServicoConfig.test.ts
// Percentual da taxa de serviço (stores.config.service_fee_rate, fração: 0.1 = 10%) e o campo em Configurações > Geral > Atendimento.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveServiceFeeRate, taxaPercentualParaConfig, TAXA_MAXIMA_PERCENT, SERVICE_FEE_RATE, calculateServiceFee } from '../../lib/calc';

// padrão atual (10%) quando a loja nunca configurou
assert.equal(SERVICE_FEE_RATE, 0.1);
assert.equal(resolveServiceFeeRate(undefined), 0.1);
assert.equal(resolveServiceFeeRate(null), 0.1);
assert.equal(resolveServiceFeeRate({}), 0.1);
assert.equal(resolveServiceFeeRate({ service_fee_rate: undefined }), 0.1);
// lê a chave da loja (inclusive 0%: loja que não cobra é válido, não é "ausente")
assert.equal(resolveServiceFeeRate({ service_fee_rate: 0.12 }), 0.12);
assert.equal(resolveServiceFeeRate({ service_fee_rate: 0.125 }), 0.125);
assert.equal(resolveServiceFeeRate({ service_fee_rate: 0 }), 0);
// valor do Master Admin (até 100%) continua valendo
assert.equal(resolveServiceFeeRate({ service_fee_rate: 0.5 }), 0.5);
// lixo cai no padrão (nunca NaN na conta)
for (const ruim of [-0.1, 1.5, NaN, Infinity, '0.1', null, {}, [], true]) assert.equal(resolveServiceFeeRate({ service_fee_rate: ruim as never }), 0.1, `valor ruim ${String(ruim)}`);
// a taxa calculada usa o percentual da loja
assert.equal(calculateServiceFee(100, resolveServiceFeeRate({ service_fee_rate: 0.15 })), 15);

// campo da tela: percentual digitado 0 a 30 -> fração gravada
assert.equal(TAXA_MAXIMA_PERCENT, 30);
assert.equal(taxaPercentualParaConfig(10), 0.1);
assert.equal(taxaPercentualParaConfig(12.5), 0.125);
assert.equal(taxaPercentualParaConfig(0), 0);
assert.equal(taxaPercentualParaConfig(45), 0.3, 'acima de 30 trava em 30');
assert.equal(taxaPercentualParaConfig(-5), 0, 'negativo vira 0');
assert.equal(taxaPercentualParaConfig(NaN), 0.1, 'sem número cai no padrão');
assert.equal(taxaPercentualParaConfig(7.123456), 0.0712, 'duas casas no percentual');

// "tudo que calcula taxa lê essa chave": ninguém lê service_fee_rate direto fora dos pontos permitidos; o resto passa por resolveServiceFeeRate
const RAIZ = path.join(__dirname, '..', '..');
const PERMITIDOS = new Set([
  'lib/calc.ts',                                  // resolveServiceFeeRate
  'lib/api.ts',                                   // criação/edição de loja pelo Master (grava a chave)
  'components/modules/AdminModule.tsx',           // campo do Master Admin
  'components/modules/settings/SecaoAtendimento.tsx', // campo do lojista
  'app/api/integracao/lojas/route.ts',            // loja criada pelo Estoque nasce com o padrão
  'types/index.ts',
]);
const achados: string[] = [];
const varrer = (dir: string) => {
  for (const nome of fs.readdirSync(path.join(RAIZ, dir))) {
    const rel = `${dir}/${nome}`;
    const st = fs.statSync(path.join(RAIZ, rel));
    if (st.isDirectory()) { if (!['node_modules', '.next', 'out', 'webapp'].includes(nome)) varrer(rel); continue; }
    if (!/\.(ts|tsx)$/.test(nome) || PERMITIDOS.has(rel)) continue;
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    src.split('\n').forEach((linha, i) => {
      if (/service_fee_rate/.test(linha) && !/^\s*(\/\/|\*)/.test(linha)) achados.push(`${rel}:${i + 1}: ${linha.trim().slice(0, 90)}`);
    });
  }
};
['app', 'lib', 'components', 'context'].forEach(varrer);
assert.deepEqual(achados, [], `leitura direta de service_fee_rate (use resolveServiceFeeRate):\n${achados.join('\n')}`);

// configs mortas removidas (gravadas na criação da loja e nunca lidas): não voltam
const mortas: string[] = [];
const varrerMortas = (dir: string) => {
  for (const nome of fs.readdirSync(path.join(RAIZ, dir))) {
    const rel = `${dir}/${nome}`;
    const st = fs.statSync(path.join(RAIZ, rel));
    if (st.isDirectory()) { if (!['node_modules', '.next', 'out', 'webapp'].includes(nome)) varrerMortas(rel); continue; }
    if (!/\.(ts|tsx)$/.test(nome)) continue;
    fs.readFileSync(path.join(RAIZ, rel), 'utf8').split('\n').forEach((linha, i) => {
      if (/\b(use_pin|allow_client_open)\b/.test(linha) && !/^\s*(\/\/|\*)/.test(linha)) mortas.push(`${rel}:${i + 1}`);
    });
  }
};
['app', 'lib', 'components', 'context', 'types'].forEach(varrerMortas);
assert.deepEqual(mortas, [], `use_pin/allow_client_open voltaram: ${mortas.join(', ')}`);
console.log('ok');
