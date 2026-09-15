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
const readline = require('readline');
const { execFile } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

// Quando empacotado como .exe (pkg), __dirname aponta pro sistema de
// arquivos virtual dentro do executável -- config.json precisa vir de
// perto do .exe real (process.execPath), não de dentro dele.
const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;

// Mesma chave anônima pública já hardcoded em lib/supabaseClient.ts do
// app principal (não é segredo -- RLS é quem protege o dado real, ver
// AGENTS.md) -- só `storeSlug` varia de instalação pra instalação.
// Achado real (2026-09-10, reclamação direta do dono: "o agente já tem
// que ser automático, não precisa baixar arquivo separado nenhum"):
// antes disso, instalar exigia baixar config.example.json À PARTE,
// renomear pra config.json e editar o slug à mão -- 3 arquivos, 3
// downloads, uma pasta pra montar igual. Agora é só o .exe: se não
// encontra config.json, PERGUNTA o slug uma vez no terminal e grava o
// arquivo sozinho, com esses defaults -- ninguém mais precisa saber que
// config.json existe.
const DEFAULT_SERVIDOR_URL = 'https://testvendase.norteparanegocios.com.br';
const DEFAULT_CHAVE_DE_ACESSO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0ODQ3MjYwLCJleHAiOjE5NDI1MjcyNjB9.YmlPFysJDamnhjkRwwNDOqNhzPIVtmrIjlucfDKPOv4';

function askQuestion(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

async function loadConfig() {
  const configPath = path.join(baseDir, 'config.json');
  let config = null;

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      console.error('\n[AVISO] config.json existente está corrompido -- vou pedir o slug de novo.\n');
      config = null;
    }
  }

  if (!config || !config.storeSlug || config.storeSlug.includes('coloque-aqui')) {
    console.log('\nPrimeira vez rodando neste computador -- preciso saber qual loja.');
    console.log('(é a parte final do link do cardápio, ex: se o link é ".../c/sertao-vai-virar-mar", o slug é "sertao-vai-virar-mar")\n');
    let slug = '';
    while (!slug) {
      slug = await askQuestion('Slug da loja: ');
      if (!slug) console.log('Não pode ficar em branco.');
    }
    config = {
      storeSlug: slug,
      servidorUrl: DEFAULT_SERVIDOR_URL,
      chaveDeAcesso: DEFAULT_CHAVE_DE_ACESSO,
      pollIntervalMs: 3000,
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`\nSalvo em config.json -- da próxima vez não vou perguntar de novo.\n`);
  }

  return config;
}

// `podeRepetir` (mesmo padrão de desktop/electron/print-engine.js, portado
// aqui em 2026-09-15): só marca como seguro repetir um erro que aconteceu
// ANTES de qualquer byte ter sido escrito no socket. Erro depois do texto
// já ter saído (impressora térmica que corta a conexão em vez de fechar
// direito, comum) nunca deve virar reimpressão -- resolve como sucesso.
function printViaNetwork(ip, port, content) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let jaEscreveu = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      const e = new Error(`Timeout conectando em ${ip}:${port}`);
      e.podeRepetir = true;
      reject(e);
    }, 5000);
    socket.connect(port, ip, () => {
      socket.write(Buffer.from(content, 'utf8'), (err) => {
        if (err) { clearTimeout(timeout); socket.destroy(); err.podeRepetir = true; reject(err); return; }
        jaEscreveu = true;
        socket.end();
      });
    });
    socket.on('close', () => { clearTimeout(timeout); resolve(); });
    socket.on('error', (err) => {
      clearTimeout(timeout);
      if (jaEscreveu) { resolve(); return; }
      err.podeRepetir = true;
      reject(err);
    });
  });
}

// Achado ao vivo, loja Sertão (2026-09-15) — "tudo mais imprime normal
// nessa impressora, só o nosso sistema sai deitado": `Out-Printer` não dá
// nenhum controle de orientação, delega inteiramente pro `PrintDocument`
// interno do cmdlet. Troca por um script .ps1 que usa
// `System.Drawing.Printing.PrintDocument` direto e FIXA
// `Landscape = $false` explicitamente (mesmo fix aplicado em
// desktop/electron/print-engine.js no mesmo dia).
const PS_PRINT_SCRIPT = `
param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$FilePath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$lines = Get-Content -Encoding UTF8 -Path $FilePath
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $PrinterName
if (-not $doc.PrinterSettings.IsValid) { throw "Impressora invalida: $PrinterName" }
$doc.DefaultPageSettings.Landscape = $false
# Margem padrao do .NET e' 1 polegada de cada lado -- numa impressora de
# 80mm (~3.15 polegadas) isso sozinho consome quase toda a largura util,
# cortando o texto no mesmo lugar sempre, independente do tamanho de papel
# escolhido no app (achado ao vivo, loja Sertao, 2026-09-15). Zera pra
# aproveitar a largura real do rolo -- o driver clampa sozinho pro minimo
# de hardware se 0 nao for suportado.
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$font = New-Object System.Drawing.Font('Consolas', 9)
$script:lineIndex = 0
$doc.add_PrintPage({
  param($sender, $e)
  $lineHeight = $font.GetHeight($e.Graphics)
  $y = $e.MarginBounds.Top
  while ($script:lineIndex -lt $lines.Count -and ($y + $lineHeight) -le $e.MarginBounds.Bottom) {
    $e.Graphics.DrawString($lines[$script:lineIndex], $font, [System.Drawing.Brushes]::Black, [float]$e.MarginBounds.Left, [float]$y)
    $y += $lineHeight
    $script:lineIndex++
  }
  $e.HasMorePages = $script:lineIndex -lt $lines.Count
})
$doc.Print()
`;

function printViaUsb(printerName, content) {
  return new Promise((resolve, reject) => {
    const stamp = Date.now();
    const tmpFile = path.join(os.tmpdir(), `ntb-print-${stamp}.txt`);
    fs.writeFileSync(tmpFile, content, 'utf8');
    const cleanup = (extra) => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      if (extra) { try { fs.unlinkSync(extra); } catch { /* ignore */ } }
    };

    if (process.platform === 'win32') {
      const scriptFile = path.join(os.tmpdir(), `ntb-print-${stamp}.ps1`);
      fs.writeFileSync(scriptFile, PS_PRINT_SCRIPT, 'utf8');
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-PrinterName', printerName, '-FilePath', tmpFile],
        (err) => {
          cleanup(scriptFile);
          if (err) reject(err); else resolve();
        }
      );
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
function runCommand(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 10000 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

async function detectLocalPrinters() {
  if (process.platform === 'win32') {
    // Dois métodos, mesclados: Get-Printer (moderno, PowerShell) pode
    // faltar/estar desabilitado em algumas instalações Windows; wmic
    // (mais antigo, mas quase sempre disponível) serve de reforço. Achado
    // ao vivo (2026-08-28): "está conectada no cabo mas não aparece" quase
    // sempre é a impressora nunca ter sido INSTALADA no Windows (sem
    // driver/fila configurada) -- nenhum dos dois métodos vê um USB cru
    // sem instalação, isso é limitação do próprio Windows, não do agente.
    const [psOut, wmicOut] = await Promise.all([
      runCommand('powershell.exe', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name']),
      runCommand('wmic.exe', ['printer', 'get', 'name']),
    ]);
    if (psOut === null && wmicOut === null) return null;
    const names = new Set();
    (psOut || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((n) => names.add(n));
    (wmicOut || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.toLowerCase() !== 'name').forEach((n) => names.add(n));
    return Array.from(names);
  } else {
    // macOS/Linux via CUPS -- `lpstat -p` imprime uma linha por
    // impressora, formato "printer NOME is idle. ...".
    const stdout = await runCommand('lpstat', ['-p']);
    if (stdout === null) return null;
    return stdout
      .split(/\r?\n/)
      .map((l) => {
        const m = l.match(/^printer\s+(\S+)/);
        return m ? m[1] : null;
      })
      .filter(Boolean);
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function printOnce(printer, content) {
  if (printer.connection_type === 'network') {
    await printViaNetwork(printer.ip_address, printer.port, content);
  } else if (printer.connection_type === 'usb') {
    await printViaUsb(printer.usb_system_name, content);
  } else {
    throw new Error(`Tipo de conexao nao suportado pelo agente: ${printer.connection_type}`);
  }
}

// Achado ao vivo (2026-08-28): InvalidPrinterException do Windows aparece
// sobretudo logo depois que a impressora acabou de ser reconfigurada
// (driver reinstalado, preferencia alterada) -- é o próprio SO ainda
// "assentando" a config nova, some sozinho em segundos. Sem retry, isso
// virava 'error' permanente na fila, exigindo alguém notar e reenviar na
// mão.
//
// Achado ao vivo, loja Sertão (2026-09-15): esse retry cego imprimiu um
// ticket de teste DUAS VEZES com um único agente rodando -- Out-Printer
// (Windows) pode reportar erro DEPOIS de já ter mandado o conteúdo pro
// spooler (impressora térmica lenta pra confirmar), e printOnce não tem
// como saber se o papel já saiu antes do erro. Repetir às cegas arrisca
// imprimir fisicamente 2x; agora só repete pra impressora de REDE, e só
// quando nada foi escrito ainda no socket (ver `podeRepetir` em
// printViaNetwork). USB nunca repete: falha vira 'error' na fila,
// reenviável na aba Impressão.
async function printJob(printer, content) {
  if (printer.connection_type !== 'network') {
    await printOnce(printer, content);
    return;
  }
  try {
    await printOnce(printer, content);
  } catch (firstErr) {
    if (!firstErr.podeRepetir) throw firstErr;
    console.error(`  Falhou na 1a tentativa (${firstErr.message}), tentando de novo em 2s...`);
    await sleep(2000);
    await printOnce(printer, content);
  }
}

async function main() {
  let config = await loadConfig();
  let supabase = createClient(config.servidorUrl, config.chaveDeAcesso);
  const pollIntervalMs = config.pollIntervalMs || 3000;

  console.log(`Agente de impressao NTB Vendas iniciado. Loja: ${config.storeSlug}`);

  let store = null;
  // Loop de recuperação: slug digitado errado no primeiro uso não deve
  // exigir achar e apagar config.json manualmente -- pergunta nome de
  // novo na hora e regrava, até achar uma loja de verdade.
  while (!store) {
    const { data, error: storeError } = await supabase.from('stores').select('id, name').eq('slug', config.storeSlug).single();
    if (data) { store = data; break; }
    console.error(`\n[ERRO] Nao encontrei nenhuma loja com o slug "${config.storeSlug}".\n`);
    const slug = await askQuestion('Digite o slug de novo (ou Ctrl+C pra sair): ');
    if (!slug) continue;
    config = { ...config, storeSlug: slug };
    fs.writeFileSync(path.join(baseDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
  }
  console.log(`Loja encontrada: ${store.name}`);

  let printersById = new Map();
  const refreshPrinters = async () => {
    const { data, error } = await supabase.from('printer_configs').select('*').eq('store_id', store.id).eq('is_active', true).in('connection_type', ['network', 'usb']);
    if (error) { console.error('Erro ao buscar impressoras cadastradas:', error.message); return; }
    printersById = new Map((data || []).map((p) => [p.id, p]));
    console.log(`Impressoras ativas (rede/USB) carregadas: ${printersById.size}`);
  };

  // Achado ao vivo (2026-08-28/29): não havia nenhum jeito de o painel
  // saber se o agente estava mesmo rodando -- migration 066. Reaproveita
  // este mesmo ciclo de 30s (não cria um setInterval a mais) pra avisar
  // "estou vivo, agora são X, Y impressoras carregadas". Best-effort: uma
  // falha aqui não pode derrubar o resto do agente, só fica sem heartbeat
  // até a próxima rodada.
  const sendHeartbeat = async () => {
    try {
      await supabase.from('print_agent_status').upsert(
        { store_id: store.id, last_seen_at: new Date().toISOString(), printers_loaded: printersById.size, updated_at: new Date().toISOString() },
        { onConflict: 'store_id' }
      );
    } catch (e) {
      console.error('Heartbeat falhou (ignorado, tenta de novo em 30s):', e.message);
    }
  };

  await refreshPrinters();
  await sendHeartbeat();
  setInterval(async () => { await refreshPrinters(); await sendHeartbeat(); }, 30000);

  await syncDiscoveredPrinters(supabase, store.id);
  console.log('Impressoras instaladas neste computador detectadas e enviadas pro painel.');
  setInterval(() => syncDiscoveredPrinters(supabase, store.id), 60000);

  // Achado ao vivo (2026-08-28): "bar" e "caixa" falharam com
  // InvalidPrinterException nos MESMOS segundos -- setInterval dispara um
  // tick novo a cada pollIntervalMs mesmo que o tick anterior ainda esteja
  // no meio de um Out-Printer (execFile tem overhead real). Dois ticks
  // sobrepostos podiam imprimir em impressoras DIFERENTES ao mesmo tempo,
  // e o Windows não aguenta duas chamadas de impressão simultâneas logo
  // depois de reconfigurar as impressoras -- derruba as duas com erro de
  // "configurações inválidas" mesmo as duas estando certas. `tickRunning`
  // garante no máximo 1 tick por vez: uma impressão sempre espera a
  // anterior terminar, não importa a impressora.
  let tickRunning = false;
  const tick = async () => {
    if (tickRunning) return;
    tickRunning = true;
    if (printersById.size === 0) { tickRunning = false; return; }
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
    } finally {
      tickRunning = false;
    }
  };

  console.log('Escutando a fila de impressao... (deixe esta janela aberta)');
  setInterval(tick, pollIntervalMs);
  tick();
}

main();
