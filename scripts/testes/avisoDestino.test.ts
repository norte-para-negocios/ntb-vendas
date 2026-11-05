// rodar com: npx tsx scripts/testes/avisoDestino.test.ts
import assert from 'node:assert/strict';
import { destinoDoAviso } from '../../lib/avisoDestino';
import { AREAS } from '../../lib/adminNav';
import { TIPOS } from '../../lib/notificacoes';

const baixa = destinoDoAviso('baixa_estoque_erro');
assert.ok(baixa);
assert.equal(baixa.tab, 'admin');
assert.equal(baixa.aba, 'integracoes');
assert.equal(baixa.secao, 'baixas-estoque');
assert.match(baixa.semAcesso, /Peça ao gerente para conferir em Administração/);

const nota = destinoDoAviso('nota_rejeitada');
assert.ok(nota);
assert.equal(nota.aba, 'notas');
assert.equal(nota.secao, undefined);

// só os dois tipos acima ganham destino; o resto segue só marcando como lido
for (const t of TIPOS) {
  if (t.tipo !== 'baixa_estoque_erro' && t.tipo !== 'nota_rejeitada') assert.equal(destinoDoAviso(t.tipo), null, t.tipo);
}
// toda aba de destino existe no menu da Administração
const abas = new Set(AREAS.flatMap((a) => a.abas.map((b) => b.id)));
for (const t of TIPOS) { const d = destinoDoAviso(t.tipo); if (d) assert.ok(abas.has(d.aba), `${t.tipo} -> ${d.aba}`); }
console.log('avisoDestino: ok');
