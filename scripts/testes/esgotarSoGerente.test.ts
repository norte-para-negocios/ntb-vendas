// rodar com: npx tsx scripts/testes/esgotarSoGerente.test.ts
// 06/10/2026: "Esgotar" só gerente/dono e só no cadastro de produto; "Preço por escolha" no formulário de produto.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tela = readFileSync('components/modules/StoreModule.tsx', 'utf8');
assert.equal((tela.match(/<StoreTableMenu [^>]*podeEsgotar=\{false\}/g) || []).length, 2, 'as duas telas de lançamento (mesa e balcão) não têm Esgotar');
assert.doesNotMatch(tela, /<StoreTableMenu [^>]*podeEsgotar=\{roleCanOr/, 'nenhuma tela de pedido libera Esgotar por permissão');
assert.match(tela, /podeEsgotar=\{user\.role === 'manager' \|\| user\.role === 'owner' \|\| user\.role === 'universal'\}/, 'só gerente/dono/universal no cadastro');
assert.match(tela, /aria-label="Produto esgotado"/);
assert.match(tela, /Preço por escolha/);
assert.match(tela, /const modoOmie = pModoVar \? 'none' : pOmieMode;/, 'produto com preço por escolha nunca guarda código próprio (evita baixa em dobro)');

const api = readFileSync('lib/api.ts', 'utf8');
assert.match(api, /set_product_sold_out_v2/);
const sql = readFileSync('supabase/migrations/165_esgotar_so_gerente.sql', 'utf8');
assert.match(sql, /r not in \('owner', 'manager'\)/);
assert.match(sql, /universal_users/);
console.log('esgotarSoGerente: ok');
