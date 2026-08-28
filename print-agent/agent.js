// Agente local de impressao do NTB Vendas.
//
// O QUE ISSO FAZ: roda neste computador (o que fica ligado na impressora
// de rede/USB da loja), fica de olho na fila de impressao do sistema
// (tabela print_jobs, aba "Impressao" do painel do lojista) e manda cada
// ticket pendente direto pra impressora configurada -- sem precisar de
// nenhum navegador aberto.
//
// Impressora "do sistema" (browser_default) NAO passa por aqui -- essa
// continua sendo o window.print() de sempre, disparado pelo navegador do
// caixa. Este agente so' cuida das impressoras cadastradas como "Rede
// (IP)" ou "USB local" na aba Impressao.
//
// Como rodar (Windows/Mac/Linux, precisa ter Node.js instalado):
//   1. Copie config.example.json para config.json e preencha o slug da
//      loja (a parte final do link do cardapio, ex: "sertao-vai-virar-mar").
//   2. No terminal, dentro desta pasta: npm install
//   3. npm start
//   Deixe essa janela do terminal aberta -- e' ela que fica escutando a
//   fila. Fechar a janela para o agente.

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error('\n[ERRO] Nao encontrei config.json nesta pasta.');
    console.error('Copie config.example.json para config.json e preencha o slug da loja antes de rodar.\n');
    process.exit(1);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  if (!config.storeSlug || config.storeSlug.includes('coloque-aqui')) {
    console.error('\n[ERRO] Preencha "storeSlug" no config.json com o slug real da loja.\n');
    process.exit(1);
  }
  return config;
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

// Achado ao vivo (2026-08-28): pedir pra digitar o nome exato da
// impressora instalada é fricção/erro desnecessário -- o computador já
// sabe quais impressoras tem instaladas. Detecta e grava em
// discovered_printers (migration 065); a aba Impressão lê de lá pra
// mostrar como lista de seleção em vez de campo de texto livre.
function detectLocalPrinters() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('powershell.exe', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'], (err, stdout) => {
        if (err) { resolve(null); return; }
        resolve(stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
      });
    } else {
      // macOS/Linux via CUPS -- `lpstat -p` imprime uma linha por
      // impressora, formato "printer NOME is idle. ...".
      execFile('lpstat', ['-p'], (err, stdout) => {
        if (err) { resolve(null); return; }
        const names = stdout
          .split(/\r?\n/)
          .map((l) => {
            const m = l.match(/^printer\s+(\S+)/);
            return m ? m[1] : null;
          })
          .filter(Boolean);
        resolve(names);
      });
    }
  });
}

async function syncDiscoveredPrinters(supabase, storeId) {
  const names = await detectLocalPrinters();
  // null = o comando falhou (ex.: lpstat/powershell não existe nesta
  // máquina) -- nunca apaga a lista já conhecida por causa disso, só
  // desiste silenciosamente desta rodada.
  if (names === null) return;
  if (names.length > 0) {
    await supabase.from('discovered_printers').upsert(
      names.map((name) => ({ store_id: storeId, name, updated_at: new Date().toISOString() })),
      { onConflict: 'store_id,name' }
    );
  }
  const { data: existing } = await supabase.from('discovered_printers').select('id, name').eq('store_id', storeId);
  const stale = (existing || []).filter((row) => !names.includes(row.name));
  if (stale.length > 0) {
    await supabase.from('discovered_printers').delete().in('id', stale.map((r) => r.id));
  }
}

async function printJob(printer, content) {
  if (printer.connection_type === 'network') {
    await printViaNetwork(printer.ip_address, printer.port, content);
  } else if (printer.connection_type === 'usb') {
    await printViaUsb(printer.usb_system_name, content);
  } else {
    throw new Error(`Tipo de conexao nao suportado pelo agente: ${printer.connection_type}`);
  }
}

async function main() {
  const config = loadConfig();
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const pollIntervalMs = config.pollIntervalMs || 3000;

  console.log(`Agente de impressao NTB Vendas iniciado. Loja: ${config.storeSlug}`);

  const { data: store, error: storeError } = await supabase.from('stores').select('id, name').eq('slug', config.storeSlug).single();
  if (storeError || !store) {
    console.error(`\n[ERRO] Nao encontrei nenhuma loja com o slug "${config.storeSlug}". Confira o config.json.\n`);
    process.exit(1);
  }
  console.log(`Loja encontrada: ${store.name}`);

  let printersById = new Map();
  const refreshPrinters = async () => {
    const { data, error } = await supabase.from('printer_configs').select('*').eq('store_id', store.id).eq('is_active', true).in('connection_type', ['network', 'usb']);
    if (error) { console.error('Erro ao buscar impressoras cadastradas:', error.message); return; }
    printersById = new Map((data || []).map((p) => [p.id, p]));
    console.log(`Impressoras ativas (rede/USB) carregadas: ${printersById.size}`);
  };

  await refreshPrinters();
  setInterval(refreshPrinters, 30000);

  await syncDiscoveredPrinters(supabase, store.id);
  console.log('Impressoras instaladas neste computador detectadas e enviadas pro painel.');
  setInterval(() => syncDiscoveredPrinters(supabase, store.id), 60000);

  const tick = async () => {
    if (printersById.size === 0) return;
    try {
      const { data: jobs, error } = await supabase
        .from('print_jobs')
        .select('*')
        .eq('store_id', store.id)
        .eq('status', 'pending')
        .in('printer_config_id', Array.from(printersById.keys()))
        .order('created_at', { ascending: true })
        .limit(20);

      if (error) { console.error('Erro ao consultar a fila:', error.message); return; }
      if (!jobs || jobs.length === 0) return;

      for (const job of jobs) {
        const printer = printersById.get(job.printer_config_id);
        if (!printer) continue;

        await supabase.from('print_jobs').update({ status: 'printing' }).eq('id', job.id);
        console.log(`Imprimindo "${job.title}" em "${printer.name}"...`);
        try {
          await printJob(printer, job.content);
          await supabase.from('print_jobs').update({ status: 'done', printed_at: new Date().toISOString() }).eq('id', job.id);
          console.log(`  OK.`);
        } catch (printErr) {
          console.error(`  FALHOU: ${printErr.message}`);
          await supabase.from('print_jobs').update({ status: 'error', error_message: String(printErr.message || printErr) }).eq('id', job.id);
        }
      }
    } catch (e) {
      console.error('Erro inesperado no ciclo de impressao (ignorado, tentando de novo):', e.message);
    }
  };

  console.log('Escutando a fila de impressao... (deixe esta janela aberta)');
  setInterval(tick, pollIntervalMs);
  tick();
}

main();
