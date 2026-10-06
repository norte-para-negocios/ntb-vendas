// rodar com: npx tsx scripts/testes/garcomNomeESenha.test.ts
// 06/10/2026: garçom sem perfil, entra na tela livre de Mesas e confirma o pedido com NOME + SENHA (migration 166).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tela = readFileSync('components/modules/StoreModule.tsx', 'utf8');
assert.match(tela, /if \(u\.role === 'waiter'\) \{\s*const aberto = usuarioAberto\(u\.store\);/, 'login de garçom cai na tela de Mesas');
assert.match(tela, /if \(restoredUser\?\.role === 'waiter'\) restoredUser = usuarioAberto\(restoredUser\.store\);/, 'sessão antiga de garçom também');
assert.match(tela, /verificarLoginEquipe\(storeId, senhaPedido\.userId, senha\)/, 'o pedido confere nome + senha');
assert.match(tela, /Toque no seu nome\./);
assert.match(tela, /role === 'waiter' \? `garcom-\$\{crypto\.randomUUID\(\)/, 'garçom novo não precisa de e-mail');

// Na tela livre o garçom ainda pede a conta e imprime a comanda (só o pagamento é do caixa)
assert.doesNotMatch(tela, /const handleRequestBill = async \(tableId: string\) => \{\s*if \(isAberto\)/, 'Pedir conta liberado na tela livre');
assert.doesNotMatch(tela, /const printTableBill = async \(tableId: string, automatica = false\) => \{\s*if \(isAberto\)/, 'Imprimir comanda liberado na tela livre');
assert.doesNotMatch(tela, /Conta e pagamento: só com login/, 'o painel que escondia o Pedir conta saiu');

const api = readFileSync('lib/api.ts', 'utf8');
assert.match(api, /verify_store_staff_login_secure/);
assert.match(api, /r\.success && r\.user_id !== userId \? \{ success: false, error: 'invalid' \} : r/, 'servidor sem a 166: continua exigindo a MESMA pessoa');
assert.match(api, /c\.storeId === storeId && c\.user_id === userId/, 'offline: só a senha conferida daquela pessoa vale');

const sql = readFileSync('supabase/migrations/166_garcom_nome_e_senha.sql', 'utf8');
assert.match(sql, /not must_change_password and password = p_password/, 'usa as senhas atuais, sem trocar nada');
assert.doesNotMatch(sql, /update store_users|alter table/i, 'a migration não mexe em senha nenhuma');
console.log('garcomNomeESenha: ok');
