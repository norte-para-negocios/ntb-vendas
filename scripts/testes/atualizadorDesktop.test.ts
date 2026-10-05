// rodar com: npx tsx scripts/testes/atualizadorDesktop.test.ts
// Atualizador do app de Windows (05/10/2026). Regressão do "app fecha para atualizar, nunca mais abre e continua na versão
// antiga": o instalador não pode matar a árvore de processos (ele é FILHO do app que está fechando) e o app tem que ter
// rede de segurança (marcador de tentativa + reabertura sozinha).
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const g = require('../../desktop/electron/update-guard.js');

// 1) comparação de versão
assert.equal(g.versaoMenor('1.2.84', '1.2.88'), true);
assert.equal(g.versaoMenor('1.2.88', '1.2.88'), false);
assert.equal(g.versaoMenor('1.2.100', '1.2.88'), false, 'compara número, não texto');
assert.equal(g.versaoMenor('1.3.0', '1.2.99'), false);

// 2) marcador: gravar, ler, apagar
const dir = mkdtempSync(join(tmpdir(), 'ntb-guard-'));
assert.equal(g.lerMarcador(dir), null);
g.gravarMarcador(dir, '1.2.88', 'silencioso');
const m = g.lerMarcador(dir);
assert.equal(m.versaoAlvo, '1.2.88');
assert.equal(m.modo, 'silencioso');
g.apagarMarcador(dir);
assert.equal(g.lerMarcador(dir), null);
rmSync(dir, { recursive: true, force: true });

// 3) script de reabertura: espera o instalador, só abre se nada estiver rodando, aspas simples no caminho escapadas, teto de 5 min
const s = g.scriptReabertura("C:\\Users\\O'Neil\\AppData\\Local\\Programs\\Norte Vendas\\Norte Vendas.exe");
assert.ok(s.includes("O''Neil"), 'aspa simples escapada');
assert.ok(s.includes("Get-Process -Name 'Norte Vendas'"), 'só abre se o app não estiver rodando');
assert.ok(s.includes("Norte Vendas Setup*"), 'espera o instalador terminar');
assert.ok(s.includes('AddSeconds(300)'), 'nunca passa de 5 minutos');
assert.ok(s.includes('Start-Process -FilePath $exe'));

// 4) o instalador NÃO pode usar taskkill /T (mataria a si mesmo: é filho do app que está fechando)
const nsh = readFileSync('desktop/build/installer.nsh', 'utf8');
const comandos = nsh.split('\n').filter((l) => l.includes('taskkill'));
assert.ok(comandos.length >= 1, 'o instalador ainda fecha o app aberto');
for (const c of comandos) assert.ok(!/\/T\b/i.test(c), `taskkill sem /T: ${c.trim()}`);

// 5) fiação no main.js: todo caminho de instalação passa pela rede de segurança
const main = readFileSync('desktop/electron/main.js', 'utf8');
assert.ok(main.includes("require('./update-guard')"));
assert.equal((main.match(/autoUpdater\.quitAndInstall\(/g) || []).length, 1, 'quitAndInstall só dentro de instalarAgora');
assert.ok(main.includes('updateGuard.agendarReabertura(process.execPath, logUpdate)'), 'reabertura de segurança agendada antes de fechar');
assert.ok(main.includes('instalacaoAnteriorFalhou'), 'detecta tentativa anterior que falhou');
assert.ok(main.includes('quitAndInstall(!visivel, true)'), 'tentativa anterior falhou = instalador visível');

console.log('atualizadorDesktop: todos os casos passaram');
