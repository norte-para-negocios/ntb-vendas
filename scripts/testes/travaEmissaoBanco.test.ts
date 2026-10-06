// rodar com: npx tsx scripts/testes/travaEmissaoBanco.test.ts
// 06/10/2026: a trava de emissão fiscal também vale no banco (migration 167), para qualquer processo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rota = readFileSync('app/api/fiscal/emitir/route.ts', 'utf8');
assert.match(rota, /rpc\('adquirir_trava_emissao', \{ p_chave: chave \}\)/);
assert.match(rota, /ganhou === false/);
assert.match(rota, /rpc\('liberar_trava_emissao'/, 'a trava é liberada no finally');
assert.match(rota, /Já existe uma emissão em andamento/);
assert.match(rota, /trava do banco indisponível \(segue com a trava em memória\)/, 'falha de infraestrutura nunca impede emitir');
const sql = readFileSync('supabase/migrations/167_trava_emissao_fiscal.sql', 'utf8');
assert.match(sql, /on conflict \(chave\) do nothing/);
assert.match(sql, /grant execute on function public\.adquirir_trava_emissao\(text, int\) to service_role/);
assert.doesNotMatch(sql, /to anon|to authenticated/, 'só a service role usa a trava');
console.log('travaEmissaoBanco: ok');
