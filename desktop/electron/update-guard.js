// Rede de segurança da atualização do app de Windows (05/10/2026). Funções puras/pequenas, testáveis fora do Electron.
// Contexto: o instalador silencioso podia falhar sem aviso (app fechava, nada instalava, nada reabria). Aqui ficam:
//  - o marcador "tentei instalar a versão X" (se ao abrir de novo a versão ainda é menor, a tentativa anterior FALHOU);
//  - o script que reabre o app sozinho se, depois da instalação, nenhum Norte Vendas estiver rodando.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ARQUIVO = 'instalacao-pendente.json';

function versaoMenor(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

function lerMarcador(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, ARQUIVO), 'utf8')); } catch { return null; }
}
function gravarMarcador(dir, versaoAlvo, modo) {
  try { fs.writeFileSync(path.join(dir, ARQUIVO), JSON.stringify({ versaoAlvo, modo, ts: Date.now() })); } catch { /* sem marcador, segue */ }
}
function apagarMarcador(dir) {
  try { fs.unlinkSync(path.join(dir, ARQUIVO)); } catch { /* já não existe */ }
}

// PowerShell que espera o instalador terminar e, se nenhum Norte Vendas estiver rodando, abre o app. Nunca fica mais de 5 min.
function scriptReabertura(exePath) {
  const exe = String(exePath).replace(/'/g, "''");
  return [
    `$exe='${exe}'`,
    '$fim=(Get-Date).AddSeconds(300)',
    'Start-Sleep -Seconds 20',
    'while ((Get-Date) -lt $fim) {',
    "  if (Get-Process -Name 'Norte Vendas' -ErrorAction SilentlyContinue) { exit }",
    "  if (-not (Get-Process | Where-Object { $_.ProcessName -like 'Norte Vendas Setup*' })) { break }",
    '  Start-Sleep -Seconds 3',
    '}',
    'Start-Sleep -Seconds 8',
    "if (-not (Get-Process -Name 'Norte Vendas' -ErrorAction SilentlyContinue)) { Start-Process -FilePath $exe }",
  ].join('\n');
}

function agendarReabertura(exePath, log) {
  if (process.platform !== 'win32') return false;
  try {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', scriptReabertura(exePath)], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    p.on('error', (e) => log && log(`WARN reabertura de segurança não iniciou: ${e.message}`));
    p.unref();
    return true;
  } catch (e) {
    if (log) log(`WARN reabertura de segurança falhou: ${e.message}`);
    return false;
  }
}

module.exports = { versaoMenor, lerMarcador, gravarMarcador, apagarMarcador, scriptReabertura, agendarReabertura };
