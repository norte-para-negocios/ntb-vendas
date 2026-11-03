// rodar com: npx tsx scripts/testes/baixaIncertoConferencia.test.ts
// Baixa "incerta" por timeout resolvida pela consulta de status do Estoque (02/11/2026). O pior erro possível aqui é
// reenviar uma baixa que o Estoque já processou (baixa em dobro no Omie): toda dúvida tem que dar 'manter'.
import assert from 'node:assert/strict';
import {
  decidirIncerto, aplicarDecisoesIncerto, ehIncertoPorTimeout, resultadoDeFalhaDeRede, MSG_INCERTO_TIMEOUT,
  type ResultadoItem, type DecisaoIncerto,
} from '../../lib/baixaEstoque';

const ENVIO = '2026-11-03T20:00:00.000Z';
const min = (m: number) => new Date(Date.parse(ENVIO) + m * 60000).toISOString();
const timeout = (codigo = 'A'): ResultadoItem => {
  const e = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  return { ...resultadoDeFalhaDeRede(e, [codigo])[0], enviadoEm: ENVIO };
};
const status = (envios: unknown[], primeiro: string | null = min(-60), ultimo: string | null = min(30)) =>
  ({ versao: 1, pedidoRef: 'p', primeiroRegistro: primeiro, ultimoRegistro: ultimo, processado: true, emAndamento: false, envios, itens: [] });
const envio = (recebidoEm: string, concluidoEm: string | null, itens: object[]) => ({ recebidoEm, concluidoEm, itens });

// O incerto por timeout é reconhecido pela mensagem de classificarErroDeRede.
assert.ok(ehIncertoPorTimeout(timeout()));
assert.ok(timeout().erro!.startsWith(MSG_INCERTO_TIMEOUT));
assert.equal(ehIncertoPorTimeout({ codigo: 'A', status: 'incerto', retentavel: false, tentativas: 1, erro: 'O Estoque respondeu HTTP 502' }), false);
assert.equal(ehIncertoPorTimeout({ codigo: 'A', status: 'erro', retentavel: true, tentativas: 1, erro: MSG_INCERTO_TIMEOUT }), false);

// 1. Estoque processou (OP criada e saída concluída) -> ok, sem reenvio.
let d = decidirIncerto(timeout(), ENVIO, status([envio(min(0.1), min(3), [{ codigo: 'A', ok: true, nCodOP: 7, op: 'criada', baixa: 'Concluido' }])]));
assert.equal(d.acao, 'ok');
assert.equal(d.acao === 'ok' && d.resultado.status, 'ok');
assert.equal(d.acao === 'ok' && d.resultado.nCodOP, 7);
assert.match(d.acao === 'ok' ? d.resultado.detalhe ?? '' : '', /Conferido sozinho no Estoque/);
// ok mesmo sem prova de registro (resolver para ok nunca reenvia nada).
assert.equal(decidirIncerto(timeout(), ENVIO, status([envio(min(0.1), min(3), [{ codigo: 'A', ok: true, op: 'sem_estrutura', baixa: 'Concluido' }])], null, null)).acao, 'ok');

// 2. Envio registrado mas sem conclusão (processando ou interrompido) -> manter.
d = decidirIncerto(timeout(), ENVIO, status([envio(min(0.1), null, [{ codigo: 'A' }])]));
assert.equal(d.acao, 'manter');

// 3. Envio concluído mas sem o resultado deste item -> manter (nunca "não processado").
assert.equal(decidirIncerto(timeout(), ENVIO, status([envio(min(0.1), min(3), [{ codigo: 'A' }])])).acao, 'manter');

// 4. Estoque processou com dúvida (OP criada sem local) -> manter.
assert.equal(decidirIncerto(timeout(), ENVIO, status([envio(min(0.1), min(3), [{ codigo: 'A', ok: false, nCodOP: 3, op: 'criada', baixa: 'sem local de estoque' }])])).acao, 'manter');
assert.equal(decidirIncerto(timeout(), ENVIO, status([envio(min(0.1), min(3), [{ codigo: 'A', ok: false, op: 'erro', baixa: 'Erro', erro: 'x' }])])).acao, 'manter');

// 5. Envio não chegou, Estoque registrava antes e depois -> erro retentável (reenvio seguro).
d = decidirIncerto(timeout(), ENVIO, status([]));
assert.equal(d.acao, 'erro');
assert.equal(d.acao === 'erro' && d.resultado.retentavel, true);
assert.equal(d.acao === 'erro' && d.resultado.status, 'erro');

// 6. Sem prova de que registrava: começou a registrar depois do envio -> manter (para sempre, é do gerente).
d = decidirIncerto(timeout(), ENVIO, status([], min(1), min(60)));
assert.equal(d.acao, 'manter');
assert.ok(d.acao === 'manter' && d.reverEmMin >= 60 * 24);
// primeiro registro dentro da margem de relógio (4 min antes) também não serve.
assert.equal(decidirIncerto(timeout(), ENVIO, status([], min(-4), min(60))).acao, 'manter');
// nenhum registro depois do envio (loja parada / Estoque voltou para versão antiga) -> manter.
assert.equal(decidirIncerto(timeout(), ENVIO, status([], min(-60), min(2))).acao, 'manter');
assert.equal(decidirIncerto(timeout(), ENVIO, status([], null, null)).acao, 'manter');

// 7. Só um envio ANTERIOR (que deu "pulada") está registrado: resolve como erro só com prova.
const anterior = envio(min(-20), min(-19), [{ codigo: 'A', ok: false, op: 'pulada', baixa: 'pulada', erro: 'Produto sem cadastro' }]);
assert.equal(decidirIncerto(timeout(), ENVIO, status([anterior])).acao, 'erro');
assert.equal(decidirIncerto(timeout(), ENVIO, status([anterior], min(-30), min(1))).acao, 'manter');
// ...e se o envio incerto chegou e terminou ok, o mais recente vence.
assert.equal(decidirIncerto(timeout(), ENVIO, status([anterior, envio(min(0.2), min(4), [{ codigo: 'A', ok: true, op: 'criada', baixa: 'Concluido', nCodOP: 1 }])])).acao, 'ok');
// ...e se chegou e ficou sem conclusão, manter.
assert.equal(decidirIncerto(timeout(), ENVIO, status([anterior, envio(min(0.2), null, [{ codigo: 'A' }])])).acao, 'manter');

// 8. Outro item do pedido não conta para este.
assert.equal(decidirIncerto(timeout('B'), ENVIO, status([envio(min(0.1), min(3), [{ codigo: 'A', ok: true, op: 'criada', baixa: 'Concluido' }])])).acao, 'erro');

// 9. Respostas inválidas / Estoque antigo / sem hora do envio -> manter.
for (const s of [null, {}, { versao: 2, envios: [] }, { versao: 1 }, { versao: 1, envios: [{}] }, 'x']) {
  assert.equal(decidirIncerto(timeout(), ENVIO, s).acao, 'manter', JSON.stringify(s));
}
assert.equal(decidirIncerto(timeout(), null, status([])).acao, 'manter');
assert.equal(decidirIncerto(timeout(), 'lixo', status([])).acao, 'manter');

// 10. Item que não é incerto por timeout nunca é mexido.
assert.equal(decidirIncerto({ codigo: 'A', status: 'incerto', retentavel: false, tentativas: 1, erro: 'O Estoque respondeu HTTP 500' }, ENVIO, status([])).acao, 'manter');
assert.equal(decidirIncerto({ codigo: 'A', status: 'ok', retentavel: false, tentativas: 1 }, ENVIO, status([])).acao, 'manter');

// 11. aplicarDecisoesIncerto: com algum 'manter', só os ok entram (nenhum reenvio).
const base: (ResultadoItem | null)[] = [timeout('A'), timeout('B'), timeout('C')];
const okA = decidirIncerto(base[0]!, ENVIO, status([envio(min(0.1), min(3), [{ codigo: 'A', ok: true, op: 'criada', baixa: 'Concluido' }])]));
const erroB = decidirIncerto(base[1]!, ENVIO, status([]));
const manterC: DecisaoIncerto = { acao: 'manter', motivo: 'x', reverEmMin: 30 };
let ap = aplicarDecisoesIncerto(base, new Map<number, DecisaoIncerto>([[0, okA], [1, erroB], [2, manterC]]));
assert.equal(ap.mudou, true);
assert.equal(ap.resultado[0]!.status, 'ok');
assert.equal(ap.resultado[1]!.status, 'incerto');
assert.equal(ap.resultado[2]!.status, 'incerto');
assert.equal(ap.reverEmMin, 15);
// Sem 'manter': ok e erro entram.
ap = aplicarDecisoesIncerto(base, new Map<number, DecisaoIncerto>([[0, okA], [1, erroB]]));
assert.equal(ap.resultado[0]!.status, 'ok');
assert.equal(ap.resultado[1]!.status, 'erro');
assert.equal(ap.resultado[1]!.retentavel, true);
assert.equal(ap.reverEmMin, null);
// Só 'manter': nada muda.
ap = aplicarDecisoesIncerto(base, new Map<number, DecisaoIncerto>([[2, manterC]]));
assert.equal(ap.mudou, false);
assert.equal(ap.reverEmMin, 30);

console.log('baixaIncertoConferencia: ok');
