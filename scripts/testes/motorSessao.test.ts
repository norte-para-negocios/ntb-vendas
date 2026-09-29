// rodar com: npx tsx scripts/testes/motorSessao.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sessao = require('../../desktop/electron/engine-session.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntb-sessao-'));
assert.equal(sessao.carregar(dir), null, 'sem arquivo = sem sessão');
const params = { storeId: 'loja-1', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon' };
sessao.salvar(dir, params);
assert.deepEqual(sessao.carregar(dir), params, 'volta o que foi salvo');
assert.equal(sessao.decidirInicio(sessao.carregar(dir), false), 'iniciar', 'app abriu, tem loja salva → liga o motor');
assert.equal(sessao.decidirInicio(sessao.carregar(dir), true), 'nada', 'já está rodando');
assert.equal(sessao.decidirInicio(null, false), 'nada', 'sem loja salva não liga nada');
fs.writeFileSync(path.join(dir, 'print-engine-session.json'), '{lixo');
assert.equal(sessao.carregar(dir), null, 'arquivo corrompido = sem sessão (nunca quebra a abertura do app)');
sessao.salvar(dir, { storeId: 'a', supabaseUrl: '', supabaseAnonKey: 'k' });
assert.equal(sessao.carregar(dir), null, 'credencial faltando = inválida');
sessao.salvar(dir, params);
sessao.limpar(dir);
assert.equal(sessao.carregar(dir), null, 'logout apaga a sessão');
sessao.limpar(dir); // limpar duas vezes não quebra
fs.rmSync(dir, { recursive: true, force: true });
console.log('ok');
