// rodar com: npx tsx scripts/testes/relatorioLink.test.ts
// Link do relatório de auditoria: só abre com assinatura válida, dentro da validade, para a loja/dia assinados.
import assert from 'node:assert/strict';
process.env.AUDIT_REPORT_TOKEN = 'segredo-de-teste';
import { gerarTokenRelatorio, validarTokenRelatorio } from '../../lib/relatorioLink';
import { textoWhatsApp } from '../../lib/relatorioAuditoria';

const loja = '4f8a9e1a-6c3d-4b2e-9f7a-8e5c1d2b3a90';
const t = gerarTokenRelatorio(loja, '2026-10-06');
assert.deepEqual(validarTokenRelatorio(t), { storeId: loja, dia: '2026-10-06' });
assert.equal(validarTokenRelatorio(t.replace('2026-10-06', '2026-10-05')), null, 'trocar o dia invalida');
assert.equal(validarTokenRelatorio(t.replace(loja, '00000000-0000-0000-0000-000000000000')), null, 'trocar a loja invalida');
assert.equal(validarTokenRelatorio(t.slice(0, -3) + 'abc'), null, 'assinatura adulterada');
assert.equal(validarTokenRelatorio(gerarTokenRelatorio(loja, '2026-10-06', -1)), null, 'vencido');
assert.equal(validarTokenRelatorio('lixo'), null);
process.env.AUDIT_REPORT_TOKEN = 'outro-segredo';
assert.equal(validarTokenRelatorio(t), null, 'segredo diferente não abre');
delete process.env.AUDIT_REPORT_TOKEN;
assert.equal(validarTokenRelatorio(t), null, 'sem segredo configurado nada abre');
assert.match(textoWhatsApp({ loja: 'X', dia: '2026-10-06', secoes: [], link: 'https://a/b' }), /Nenhuma ação/);
console.log('relatorioLink: ok');
