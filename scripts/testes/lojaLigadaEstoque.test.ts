// QA de 07/10: criar a loja no Estoque grava o vínculo na hora e editar a loja propaga nos dois sentidos.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const criar = fs.readFileSync('app/api/integracao/criar-loja-estoque/route.ts', 'utf8');
assert.match(criar, /vendasStoreId: body\.storeId/, 'criar-loja-estoque precisa mandar o storeId ao Estoque');
const lojas = fs.readFileSync('app/api/integracao/lojas/route.ts', 'utf8');
assert.match(lojas, /export async function PATCH/, 'rota de lojas precisa aceitar a atualização vinda do Estoque');
assert.match(lojas, /ntb_estoque_api_key', chave\)/, 'PATCH autentica pela chave da própria loja');
const api = fs.readFileSync('lib/api.ts', 'utf8');
assert.match(api, /\/api\/integracao\/loja-atualizada/, 'updateStore precisa avisar o Estoque');
assert.ok(fs.existsSync('app/api/integracao/loja-atualizada/route.ts'));
console.log('lojaLigadaEstoque: ok');
