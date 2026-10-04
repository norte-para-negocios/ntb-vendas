// rodar com: npx tsx scripts/testes/baixaEstoque.test.ts
// Regras do outbox da baixa de estoque (Vendas -> Estoque): o que conta como ok, o que pode ser reenviado
// sozinho e o que NUNCA pode (a criação da OP no Estoque não é idempotente: cCodIntOP = timestamp).
import assert from 'node:assert/strict';
import {
  classificarItemEstoque, classificarErroDeRede, interpretarResposta, mesclarResultados, statusDaBaixa,
  indicesParaReenviar, proximaTentativa, marcarIncertosComoConferidos, marcarEnvioInterrompido, MAX_TENTATIVAS,
  type ResultadoItem,
} from '../../lib/baixaEstoque';

const base = { tentativas: 1 };
const item = (over: Partial<ResultadoItem>): ResultadoItem => ({ codigo: 'X', status: 'ok', retentavel: false, tentativas: 1, ...over });

// ---------- itens de loja REAL (resposta com op/baixa) ----------
const ok = (o: object) => classificarItemEstoque({ codigo: 'A', ...o } as never);

assert.equal(ok({ ok: true, nCodOP: 5, op: 'criada', baixa: 'Concluido' }).status, 'ok');
assert.equal(ok({ ok: true, op: 'sem_estrutura', baixa: 'Concluido' }).status, 'ok');          // revenda: só a saída
assert.equal(ok({ ok: true, op: 'na_fila', baixa: 'Concluido' }).status, 'ok');                 // a fila do Estoque reenvia
assert.equal(ok({ ok: true, nCodOP: 5, op: 'criada', baixa: 'Erro' }).status, 'ok');            // movimento existe e tem retry no Estoque
assert.equal(ok({ ok: true, nCodOP: 5, op: 'criada', baixa: 'Sem CMC' }).status, 'ok');

// Nada foi gravado: pode reenviar sozinho.
const pulada = ok({ ok: false, op: 'pulada', baixa: 'pulada', erro: 'Produto sem cadastro correspondente no ntb-estoque' });
assert.equal(pulada.status, 'erro');
assert.equal(pulada.retentavel, true);
assert.match(pulada.erro ?? '', /sem cadastro/);

// Sem estrutura mas sem local: nada gravado (nem OP nem saída) -> reenvia depois de configurar o local.
const semEstSemLocal = ok({ ok: true, op: 'sem_estrutura', baixa: 'sem local de estoque' });
assert.equal(semEstSemLocal.status, 'erro');
assert.equal(semEstSemLocal.retentavel, true);

// OP criada e saída não feita (sem local): reenviar criaria OP em duplicidade -> gerente decide.
const opSemLocal = ok({ ok: true, nCodOP: 7, op: 'criada', baixa: 'sem local de estoque' });
assert.equal(opSemLocal.status, 'incerto');
assert.equal(opSemLocal.retentavel, false);
assert.equal(ok({ ok: true, op: 'na_fila', baixa: 'sem local de estoque' }).status, 'incerto');

// OP com erro: a saída pode ter sido gravada, ou a OP criada e não concluída -> nunca reenvia sozinho.
assert.equal(ok({ ok: false, nCodOP: 9, op: 'erro', baixa: 'Concluido', erro: 'conclusão falhou' }).status, 'incerto');
assert.equal(ok({ ok: false, op: 'erro', baixa: 'Concluido', erro: 'Omie recusou' }).status, 'incerto');
// ...exceto quando comprovadamente nada foi gravado (OP recusada sem nº e sem saída por falta de local).
const recusada = ok({ ok: false, op: 'erro', baixa: 'sem local de estoque', erro: 'Omie recusou: campo inválido' });
assert.equal(recusada.status, 'erro');
assert.equal(recusada.retentavel, true);
// "Omie não retornou a OP" é ambíguo (a OP pode existir).
assert.equal(ok({ ok: false, op: 'erro', baixa: 'sem local de estoque', erro: 'Omie não retornou a OP criada' }).status, 'incerto');

// ---------- itens de loja de TESTE (resposta sem op/baixa) ----------
assert.equal(ok({ ok: true, nCodOP: 3 }).status, 'ok');
assert.equal(ok({ ok: false, erro: 'O produto 12 não possui nenhum item na sua estrutura' }).status, 'ok');
const testeSemCad = ok({ ok: false, erro: 'Produto sem cadastro correspondente no ntb-estoque' });
assert.equal(testeSemCad.status, 'erro');
assert.equal(testeSemCad.retentavel, true);
assert.equal(ok({ ok: false, nCodOP: 3, erro: 'conclusão falhou' }).status, 'incerto');
assert.equal(ok({ ok: false, erro: 'Falha desconhecida' }).retentavel, true);

// ---------- falha de transporte ----------
const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
assert.equal(classificarErroDeRede(refused).ambiguo, false);                       // nunca chegou no Estoque
assert.equal(classificarErroDeRede(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })).ambiguo, false);
assert.equal(classificarErroDeRede(Object.assign(new TypeError('fetch failed'), { cause: { errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }] } })).ambiguo, false); // localhost v4+v6
assert.equal(classificarErroDeRede(Object.assign(new TypeError('fetch failed'), { cause: { errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNRESET' }] } })).ambiguo, true);
assert.equal(classificarErroDeRede(Object.assign(new Error('x'), { name: 'TimeoutError' })).ambiguo, true);   // timeout: ambíguo
assert.equal(classificarErroDeRede(Object.assign(new Error('x'), { name: 'AbortError' })).ambiguo, true);
assert.equal(classificarErroDeRede(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })).ambiguo, true);
assert.equal(classificarErroDeRede(new Error('qualquer coisa')).ambiguo, true);

// ---------- resposta HTTP inteira ----------
// 200 com todos os itens falhando NÃO é sucesso.
const todosFalham = interpretarResposta(200, { resultados: [
  { codigo: 'A', ok: false, op: 'pulada', baixa: 'pulada', erro: 'Produto sem cadastro correspondente no ntb-estoque' },
  { codigo: 'B', ok: false, op: 'pulada', baixa: 'pulada', erro: 'Produto sem cadastro correspondente no ntb-estoque' },
] }, ['A', 'B']);
assert.deepEqual(todosFalham.map((r) => r.status), ['erro', 'erro']);
assert.equal(statusDaBaixa(todosFalham, 2), 'erro');

// 200 com menos resultados do que itens enviados: o que faltou é incerto.
const faltou = interpretarResposta(200, { resultados: [{ codigo: 'A', ok: true, op: 'criada', baixa: 'Concluido', nCodOP: 1 }] }, ['A', 'B']);
assert.deepEqual(faltou.map((r) => r.status), ['ok', 'incerto']);
// 200 sem lista de resultados.
assert.deepEqual(interpretarResposta(200, { skipped: true }, ['A']).map((r) => r.status), ['incerto']);
assert.deepEqual(interpretarResposta(200, null, ['A']).map((r) => r.status), ['incerto']);
// 401/400/404: o Estoque recusou antes de processar nada -> reenvia depois.
for (const s of [400, 401, 403, 404]) {
  const r = interpretarResposta(s, { error: 'Chave de integração inválida' }, ['A']);
  assert.equal(r[0].status, 'erro', `http ${s}`);
  assert.equal(r[0].retentavel, true);
  assert.match(r[0].erro ?? '', /Chave de integração inválida/);
}
// 500/502/503/504: a rota pode ter rodado parte -> incerto, não reenvia sozinho.
for (const s of [500, 502, 503, 504]) {
  const r = interpretarResposta(s, { error: 'boom' }, ['A', 'B']);
  assert.deepEqual(r.map((x) => x.status), ['incerto', 'incerto'], `http ${s}`);
  assert.ok(r.every((x) => !x.retentavel));
}

// ---------- status da baixa ----------
assert.equal(statusDaBaixa([item({}), item({})], 2), 'ok');
assert.equal(statusDaBaixa([item({}), item({ status: 'erro', retentavel: true })], 2), 'parcial');
assert.equal(statusDaBaixa([item({ status: 'erro', retentavel: true }), item({ status: 'erro', retentavel: true })], 2), 'erro');
assert.equal(statusDaBaixa([item({}), item({ status: 'incerto' })], 2), 'incerto');
assert.equal(statusDaBaixa([item({ status: 'incerto' }), item({ status: 'erro', retentavel: true })], 2), 'parcial');
assert.equal(statusDaBaixa([item({}), null], 2), 'pending');          // item que ainda não foi enviado
assert.equal(statusDaBaixa([], 0), 'ok');

// ---------- o que reenviar ----------
const resultado: (ResultadoItem | null)[] = [
  item({ codigo: 'A' }),                                         // ok: nunca reenvia
  item({ codigo: 'B', status: 'erro', retentavel: true }),       // erro comprovado: reenvia
  item({ codigo: 'C', status: 'incerto' }),                      // incerto: NUNCA reenvia sozinho
  null,                                                          // nunca enviado: envia
  item({ codigo: 'E', status: 'erro', retentavel: false }),      // erro não retentável: não reenvia
];
assert.deepEqual(indicesParaReenviar(resultado, 5), [1, 3]);
assert.deepEqual(indicesParaReenviar([], 2), [0, 1]);              // primeira tentativa: todos

// ---------- mesclar ----------
const novo = [item({ codigo: 'B', tentativas: 2 }), item({ codigo: 'D', tentativas: 1 })];
const mesclado = mesclarResultados(resultado, [1, 3], novo);
assert.equal(mesclado[0]?.status, 'ok');
assert.equal(mesclado[1]?.tentativas, 2);
assert.equal(mesclado[2]?.status, 'incerto');                      // intocado
assert.equal(mesclado[3]?.codigo, 'D');
assert.equal(resultado[1]?.tentativas, 1);                         // não mutou o original

// ---------- backoff ----------
const t0 = Date.parse('2026-10-04T12:00:00Z');
const min = (n: number) => proximaTentativa(n, t0).getTime() - t0;
assert.equal(min(1), 2 * 60000);
assert.equal(min(2), 4 * 60000);
assert.equal(min(3), 8 * 60000);
assert.ok(min(10) <= 60 * 60000);
assert.ok(min(2) > min(1));
assert.ok(MAX_TENTATIVAS >= 4 && MAX_TENTATIVAS <= 10);

// ---------- ações manuais / recuperação ----------
const conferido = marcarIncertosComoConferidos(resultado, 'Gerente Ana');
assert.equal(conferido[2]?.status, 'ok');
assert.match(conferido[2]?.detalhe ?? '', /conferid/i);
assert.equal(conferido[1]?.status, 'erro');                        // erro retentável continua erro
assert.equal(resultado[2]?.status, 'incerto');

// Processo caiu no meio do envio: o que estava em voo vira incerto; o que já estava ok fica.
const interrompido = marcarEnvioInterrompido([item({ codigo: 'A' }), item({ codigo: 'B', status: 'erro', retentavel: true }), null], [1, 2], [{ codigo: 'A' }, { codigo: 'B' }, { codigo: 'C' }]);
assert.deepEqual(interrompido.map((r) => r?.status), ['ok', 'incerto', 'incerto']);
assert.equal(interrompido[2]?.codigo, 'C');

void base;
console.log('ok');
