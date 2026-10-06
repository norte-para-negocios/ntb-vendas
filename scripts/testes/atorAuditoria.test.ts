// rodar com: npx tsx scripts/testes/atorAuditoria.test.ts
// O ator que vai no cabeçalho X-NTB-Actor é decodificado pelo banco (ntb_actor): base64 de JSON UTF-8, nomes com acento incluídos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cabecalhoAtor, cabecalhosApi, codificarAtor, definirAtor } from '../../lib/atorAtual';

definirAtor(null);
assert.equal(cabecalhoAtor(), null, 'sem login, sem cabeçalho');
assert.equal(cabecalhosApi()['x-ntb-actor'], undefined);

definirAtor({ id: 'u-1', name: 'João Conceição', role: 'waiter' });
const h = cabecalhoAtor()!;
assert.deepEqual(JSON.parse(Buffer.from(h, 'base64').toString('utf8')), { id: 'u-1', name: 'João Conceição', role: 'waiter' });
assert.equal(cabecalhosApi({ A: 'b' })['x-ntb-actor'], h);
assert.equal(cabecalhosApi()['Content-Type'], 'application/json');
assert.match(codificarAtor({ id: null, name: 'Conta universal', role: 'universal' }), /^[A-Za-z0-9+/=]+$/, 'base64 puro: passa no filtro do servidor');
definirAtor(null);

// o cliente do Supabase manda o cabeçalho em toda requisição ao banco, e o servidor só repassa base64 válido
const cli = readFileSync('lib/supabaseClient.ts', 'utf8');
assert.match(cli, /url\.includes\('\/rest\/v1\/'\) \? cabecalhoAtor\(\) : null/);
assert.match(cli, /h\.set\('x-ntb-actor', ator\)/);
const adm = readFileSync('lib/supabaseAdmin.ts', 'utf8');
assert.match(adm, /\^\[A-Za-z0-9\+\/=\]\{8,2000\}\$/);
console.log('atorAuditoria: ok');
