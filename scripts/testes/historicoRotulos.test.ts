// rodar com: npx tsx scripts/testes/historicoRotulos.test.ts
import assert from 'node:assert/strict';
import { periodoHistorico, subtituloHistorico, nomeArquivoHistorico, filtrosAtivosHistorico } from '../../lib/reports/historicoRotulos';
import { EMPTY_FILTERS } from '../../lib/reports/salesFilters';

const base = { filtros: EMPTY_FILTERS };
assert.equal(subtituloHistorico(base), 'Todo o histórico');
assert.equal(nomeArquivoHistorico(base, 'zz'), 'relatorio-vendas_todo-historico_zz.xlsx');
const cred = { ...base, filtros: { ...EMPTY_FILTERS, method: 'CREDIT' } };
assert.equal(subtituloHistorico(cred), 'Todo o histórico · Filtrado: Forma: Crédito');
assert.equal(nomeArquivoHistorico(cred, 'zz'), 'relatorio-vendas_todo-historico_filtrado_zz.xlsx', 'arquivo filtrado não tem o mesmo nome do geral');
const per = { ...base, inicio: '2026-09-04', fim: '2026-10-04', tipo: 'counter' };
assert.equal(periodoHistorico(per).label, 'De 04/09/2026 até 04/10/2026');
assert.equal(nomeArquivoHistorico(per, 'zz'), 'relatorio-vendas_2026-09-04_a_2026-10-04_filtrado_zz.xlsx');
assert.deepEqual(filtrosAtivosHistorico({ ...base, cliente: 'Ana', minTotal: '50' }), ['Cliente/Mesa: Ana', 'Total a partir de R$ 50']);
console.log('historicoRotulos: ok');
