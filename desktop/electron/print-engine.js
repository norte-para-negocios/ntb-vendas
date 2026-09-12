// Motor de impressão embutido no app desktop.
//
// POR QUE ISSO EXISTE (pedido direto do dono, 2026-09-12: "a questão da
// impressora ligada já no app, preciso disso funcionando"): até aqui,
// imprimir em impressora de REDE (IP) ou USB exigia um segundo programa
// rodando no PC da loja (`print-agent/`, fora do Next.js) — porque o
// NAVEGADOR não consegue abrir socket cru nem chamar o spooler do sistema.
// Mas o app desktop é Electron: o processo principal é Node completo e faz
// exatamente as mesmas duas coisas. O programa separado era redundante aqui.
//
// Resultado prático: quem usa o app desktop não instala mais nada. Abriu o
// app e logou numa loja, a impressão de rede/USB daquela loja já funciona —
// e para junto com o app, sem processo órfão. O `print-agent/` continua
// existindo só pra quem opera o sistema pelo navegador.
//
// Mesmas escolhas técnicas do agente original, pelos mesmos motivos:
//   - rede: socket TCP puro na porta 9100 (RAW/JetDirect), sem dependência;
//   - USB: `Out-Printer` do PowerShell (Windows) / `lp` (Mac/Linux), nunca um
//     módulo nativo tipo `node-printer`, que exigiria compilar binding e
//     quebraria o build do instalador.
// Acesso ao banco por REST puro (fetch global do Node) em vez de
// @supabase/supabase-js: são 4 tabelas com RLS `allow_all_anon` (ver
// AGENTS.md) e nenhuma chamada precisa de sessão — não vale uma dependência
// nova no bundle do app por isso.

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');

const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 30000;
const DISCOVER_INTERVAL_MS = 60000;

let timers = [];
let currentStoreId = null;
let log = () => {};
let cfg = { baseUrl: '', anonKey: '' };

function rest(pathAndQuery, init = {}) {
  return fetch(`${cfg.baseUrl}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

function printViaNetwork(ip, port, content) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timeout conectando em ${ip}:${port}`));
    }, 5000);
    socket.connect(port, ip, () => {
      socket.write(Buffer.from(content, 'utf8'), (err) => {
        if (err) { clearTimeout(timeout); socket.destroy(); reject(err); return; }
        socket.end();
      });
    });
    socket.on('close', () => { clearTimeout(timeout); resolve(); });
    socket.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

function escapePowerShellSingleQuoted(value) {
  return value.replace(/'/g, "''");
}

function printViaUsb(printerName, content) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `ntb-print-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content, 'utf8');
    const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch { /* ignore */ } };

    if (process.platform === 'win32') {
      const safeFile = escapePowerShellSingleQuoted(tmpFile);
      const safeName = escapePowerShellSingleQuoted(printerName);
      const psCommand = `Get-Content -Encoding UTF8 -Path '${safeFile}' | Out-Printer -Name '${safeName}'`;
      execFile('powershell.exe', ['-NoProfile', '-Command', psCommand], (err) => {
        cleanup();
        if (err) reject(err); else resolve();
      });
    } else {
      execFile('lp', ['-d', printerName, tmpFile], (err) => {
        cleanup();
        if (err) reject(err); else resolve();
      });
    }
  });
}

function runCommand(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 10000 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// Detecta as impressoras instaladas NESTA máquina e publica a lista, pra a
// aba Impressão do painel oferecer seleção em vez de campo de texto livre.
// Achado real que justifica isso (Sertão, 2026-09-12): a loja tinha uma
// impressora USB cadastrada como "dscfwdefr3" — nome digitado à mão que não
// batia com nenhuma impressora instalada, então nunca imprimiria.
async function detectLocalPrinters() {
  if (process.platform === 'win32') {
    const [psOut, wmicOut] = await Promise.all([
      runCommand('powershell.exe', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name']),
      runCommand('wmic.exe', ['printer', 'get', 'name']),
    ]);
    if (psOut === null && wmicOut === null) return null;
    const names = new Set();
    (psOut || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((n) => names.add(n));
    (wmicOut || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.toLowerCase() !== 'name').forEach((n) => names.add(n));
    return Array.from(names);
  }
  const stdout = await runCommand('lpstat', ['-p']);
  if (stdout === null) return null;
  return stdout.split(/\r?\n/).map((l) => (l.match(/^printer\s+(\S+)/) || [])[1]).filter(Boolean);
}

async function syncDiscoveredPrinters(storeId) {
  const names = await detectLocalPrinters();
  // null = o comando falhou nesta máquina; nunca apaga a lista já conhecida
  // por causa disso, só desiste desta rodada.
  if (names === null) return;
  if (names.length > 0) {
    await rest('discovered_printers?on_conflict=store_id,name', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(names.map((name) => ({ store_id: storeId, name, updated_at: new Date().toISOString() }))),
    });
  }
  const existing = await rest(`discovered_printers?select=id,name&store_id=eq.${storeId}`).then((r) => r.json()).catch(() => []);
  const stale = (Array.isArray(existing) ? existing : []).filter((row) => !names.includes(row.name));
  for (const row of stale) {
    await rest(`discovered_printers?id=eq.${row.id}`, { method: 'DELETE' }).catch(() => {});
  }
}

async function sendHeartbeat(storeId, printersLoaded) {
  // O painel usa isto pra dizer "agente conectado / offline há X min" — sem
  // heartbeat ninguém consegue saber, de fora, se a impressão automática
  // está de pé (ver PrinterSettingsView.tsx).
  try {
    await rest('print_agent_status?on_conflict=store_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        store_id: storeId,
        last_seen_at: new Date().toISOString(),
        printers_loaded: printersLoaded,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    log(`WARN heartbeat falhou (ignorado): ${e.message}`);
  }
}

async function printOnce(printer, content) {
  if (printer.connection_type === 'network') {
    await printViaNetwork(printer.ip_address, printer.port, content);
  } else if (printer.connection_type === 'usb') {
    await printViaUsb(printer.usb_system_name, content);
  } else {
    throw new Error(`Tipo de conexão não suportado aqui: ${printer.connection_type}`);
  }
}

// 1 retentativa: InvalidPrinterException do Windows aparece sobretudo logo
// depois da impressora ser reconfigurada e some sozinha em segundos. Sem
// isso virava 'error' permanente na fila (achado do agente original).
async function printJob(printer, content) {
  try {
    await printOnce(printer, content);
  } catch (firstErr) {
    log(`WARN 1a tentativa falhou (${firstErr.message}), tentando de novo em 2s`);
    await new Promise((r) => setTimeout(r, 2000));
    await printOnce(printer, content);
  }
}

function stop() {
  timers.forEach(clearInterval);
  timers = [];
  currentStoreId = null;
}

// Chamado pelo renderer assim que se sabe QUAL loja está logada (ver
// preload.js/StoreModule.tsx). Não existe config.json nem slug digitado à
// mão como no agente separado: a loja é simplesmente a que está no app.
function start(storeId, options) {
  if (!storeId) return { ok: false, reason: 'storeId ausente' };
  if (currentStoreId === storeId) return { ok: true, already: true };
  stop();

  currentStoreId = storeId;
  cfg = { baseUrl: options.baseUrl, anonKey: options.anonKey };
  log = options.log || (() => {});
  log(`INFO motor de impressão iniciado para a loja ${storeId}`);

  let printersById = new Map();

  const refreshPrinters = async () => {
    try {
      const data = await rest(
        `printer_configs?select=*&store_id=eq.${storeId}&is_active=eq.true&connection_type=in.(network,usb)`
      ).then((r) => r.json());
      printersById = new Map((Array.isArray(data) ? data : []).map((p) => [p.id, p]));
    } catch (e) {
      log(`ERROR ao buscar impressoras: ${e.message}`);
    }
  };

  let tickRunning = false;
  const tick = async () => {
    // Garante no máximo 1 tick por vez: dois Out-Printer simultâneos logo
    // depois de reconfigurar impressora derrubam os dois no Windows (achado
    // ao vivo do agente original, 2026-08-28).
    if (tickRunning || printersById.size === 0) return;
    tickRunning = true;
    try {
      const ids = Array.from(printersById.keys()).join(',');
      const jobs = await rest(
        `print_jobs?select=*&store_id=eq.${storeId}&status=eq.pending&printer_config_id=in.(${ids})&order=created_at.asc&limit=20`
      ).then((r) => r.json());

      for (const job of Array.isArray(jobs) ? jobs : []) {
        const printer = printersById.get(job.printer_config_id);
        if (!printer) continue;
        await rest(`print_jobs?id=eq.${job.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'printing' }) });
        log(`INFO imprimindo "${job.title}" em "${printer.name}"`);
        try {
          await printJob(printer, job.content);
          await rest(`print_jobs?id=eq.${job.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'done', printed_at: new Date().toISOString() }),
          });
          log('INFO impresso OK');
        } catch (printErr) {
          log(`ERROR falhou: ${printErr.message}`);
          await rest(`print_jobs?id=eq.${job.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'error', error_message: String(printErr.message || printErr) }),
          });
        }
      }
    } catch (e) {
      log(`ERROR ciclo de impressão (ignorado, tenta de novo): ${e.message}`);
    } finally {
      tickRunning = false;
    }
  };

  refreshPrinters().then(() => {
    sendHeartbeat(storeId, printersById.size);
    syncDiscoveredPrinters(storeId).catch((e) => log(`WARN detecção de impressoras falhou: ${e.message}`));
    tick();
  });

  timers.push(setInterval(async () => {
    await refreshPrinters();
    await sendHeartbeat(storeId, printersById.size);
  }, HEARTBEAT_INTERVAL_MS));
  timers.push(setInterval(() => syncDiscoveredPrinters(storeId).catch(() => {}), DISCOVER_INTERVAL_MS));
  timers.push(setInterval(tick, POLL_INTERVAL_MS));

  return { ok: true };
}

module.exports = { start, stop };
