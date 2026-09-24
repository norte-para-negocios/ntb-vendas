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
const dns = require('dns').promises;
const { execFile } = require('child_process');

const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 30000;
const DISCOVER_INTERVAL_MS = 60000;
// Comanda antiga não pode sair. Achado na revisão independente (2026-09-13):
// a fila é do SERVIDOR e continua enchendo com o app fechado (o PDV no
// navegador e os outros terminais seguem enfileirando). Sem corte de idade,
// abrir o app de manhã cuspiria na cozinha o lote inteiro da noite anterior.
// Job mais velho que isso é descartado como obsoleto, nunca impresso.
const IDADE_MAXIMA_JOB_MS = 30 * 60 * 1000;

let timers = [];
let currentStoreId = null;
let log = () => {};
let cfg = { baseUrl: '', anonKey: '' };
// Incrementado a cada start()/stop(). Um ciclo de impressão que já estava em
// VOO quando a loja mudou (logout, "Trocar de Loja") compara sua geração com
// esta antes de cada passo e desiste — senão ele continuaria imprimindo e
// escrevendo em nome da loja anterior, e ainda poderia rodar em paralelo com
// o ciclo da loja nova (duas impressões simultâneas derrubam as duas no
// Windows, ver o comentário do tick).
let geracao = 0;
// Impressoras que ESTA máquina publicou na última varredura. Usado pra nunca
// apagar de `discovered_printers` uma impressora de OUTRO computador da mesma
// loja (o caixa e a cozinha têm impressoras USB diferentes).
let publicadasPorEstaMaquina = new Set();
// Impressoras instaladas NESTE computador (última varredura, mesmo sem internet).
let nomesLocais = [];

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${cfg.baseUrl}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  // `fetch` NÃO lança em 4xx/5xx. Sem esta checagem, uma chave expirada ou um
  // erro de schema do PostgREST devolvia um objeto de erro que simplesmente
  // não era array — a fila ficava vazia PRA SEMPRE, em silêncio, enquanto o
  // heartbeat seguia dizendo "conectado" (achado da revisão independente).
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} em ${pathAndQuery.split('?')[0]} ${corpo.slice(0, 200)}`);
  }
  return res;
}

function printViaNetwork(ip, port, content, raw) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    // Depois que os bytes saíram, o papel JÁ ESTÁ SAINDO — um erro de socket
    // a partir daí (impressora térmica barata que corta a conexão em vez de
    // fechar direito é comum) não pode virar "falhou" e disparar
    // reimpressão, senão a comanda sai duas vezes. Achado da revisão
    // independente. Antes disso, qualquer erro rejeitava.
    let jaEscreveu = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      const e = new Error(`Timeout conectando em ${ip}:${port}`);
      e.podeRepetir = true; // nada foi impresso ainda — repetir é seguro
      reject(e);
    }, 5000);
    socket.connect(port, ip, () => {
      socket.write(raw ? toEscPos(content) : Buffer.from(content, 'utf8'), (err) => {
        if (err) {
          clearTimeout(timeout);
          socket.destroy();
          err.podeRepetir = true;
          reject(err);
          return;
        }
        jaEscreveu = true;
        socket.end();
      });
    });
    socket.on('close', () => { clearTimeout(timeout); resolve(); });
    socket.on('error', (err) => {
      clearTimeout(timeout);
      if (jaEscreveu) {
        log(`WARN erro no socket DEPOIS de mandar o texto (${err.message}) — tratando como impresso, pra não sair duas vezes`);
        resolve();
        return;
      }
      err.podeRepetir = true;
      reject(err);
    });
  });
}

// Achado ao vivo, loja Sertão (2026-09-15) — "tudo mais imprime normal
// nessa impressora, só o nosso sistema sai deitado": `Out-Printer` (usado
// até aqui) não dá NENHUM controle de orientação — ele delega inteiramente
// pro objeto .NET `PrintDocument` interno do cmdlet, cujo comportamento de
// orientação/tamanho de página é opaco e, na prática, se mostrou diferente
// do que qualquer outro programa manda pra essa mesma impressora física.
// Troca por um script .ps1 que usa `System.Drawing.Printing.PrintDocument`
// diretamente e FIXA `Landscape = $false` de forma explícita (em vez de
// deixar o cmdlet decidir sozinho) — dá controle de verdade sobre a
// orientação em vez de confiar em comportamento implícito.
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
$script:font = New-Object System.Drawing.Font('Consolas', 9)
$font = $script:font
$script:lineIndex = 0
$doc.add_PrintPage({
  param($sender, $e)
  $font = $script:font
  $lineHeight = $font.GetHeight($e.Graphics)
  $y = $e.MarginBounds.Top
  while ($script:lineIndex -lt $lines.Count -and ($y + $lineHeight) -le $e.MarginBounds.Bottom) {
    $texto = $lines[$script:lineIndex]
    # Centralizado (pedido direto, 2026-09-15) -- mesmo padrao visual de
    # cupom termico de qualquer PDV: cada linha centrada na largura real do
    # papel, nao alinhada a esquerda. Nunca fica negativo se a linha for
    # mais larga que a pagina (cai pra esquerda nesse caso raro).
    $largura = $e.Graphics.MeasureString($texto, $font).Width
    $x = $e.MarginBounds.Left + [Math]::Max(0, ($e.MarginBounds.Width - $largura) / 2)
    $e.Graphics.DrawString($texto, $font, [System.Drawing.Brushes]::Black, [float]$x, [float]$y)
    $y += $lineHeight
    $script:lineIndex++
  }
  $e.HasMorePages = $script:lineIndex -lt $lines.Count
})
$doc.Print()
`;

// Modo 'raw': manda os bytes ESC/POS direto pro spooler (datatype RAW), sem
// passar pelo driver GDI -- a impressora térmica usa a fonte e a largura
// dela mesma. Resolve drivers que escalam/cortam o texto (loja Sertao,
// 2026-09-24: a impressora da pizzaria saia com fonte gigante e cortada).
const PS_RAW_SCRIPT = `
param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$FilePath
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class NtbRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  public static void Send(string printerName, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printerName, out h, IntPtr.Zero)) throw new Exception("Nao abriu a impressora: " + printerName);
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = "NTB Vendas";
      di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) throw new Exception("StartDocPrinter falhou");
      try {
        if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter falhou");
        IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, p, bytes.Length);
          int w;
          if (!WritePrinter(h, p, bytes.Length, out w) || w != bytes.Length) throw new Exception("WritePrinter falhou");
        } finally { Marshal.FreeCoTaskMem(p); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
$bytes = [System.IO.File]::ReadAllBytes($FilePath)
[NtbRawPrinter]::Send($PrinterName, $bytes)
`;

const CP850 = { 'á':0xA0,'é':0x82,'í':0xA1,'ó':0xA2,'ú':0xA3,'à':0x85,'è':0x8A,'ã':0xC6,'õ':0xE4,'â':0x83,'ê':0x88,'ô':0x93,'ç':0x87,'ü':0x81,
  'Á':0xB5,'É':0x90,'Í':0xD6,'Ó':0xE0,'Ú':0xE9,'À':0xB7,'Ã':0xC7,'Õ':0xE5,'Â':0xB6,'Ê':0xD2,'Ô':0xE2,'Ç':0x80,'º':0xA7,'ª':0xA6,'°':0xF8 };

function toEscPos(content) {
  const out = [0x1B, 0x40, 0x1B, 0x74, 0x02, 0x1B, 0x61, 0x01]; // init, CP850, centralizado
  const texto = String(content).replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/\r/g, '');
  for (const ch of texto) {
    const c = ch.codePointAt(0);
    if (c === 10) out.push(0x0A);
    else if (c < 128) out.push(c);
    else out.push(CP850[ch] !== undefined ? CP850[ch] : 0x3F);
  }
  out.push(0x0A, 0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00); // avanca e corta
  return Buffer.from(out);
}

function printViaUsbRaw(printerName, content) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') { reject(new Error('Modo direto (ESC/POS) só existe no Windows.')); return; }
    const stamp = Date.now();
    const binFile = path.join(os.tmpdir(), `ntb-raw-${stamp}.bin`);
    const scriptFile = path.join(os.tmpdir(), `ntb-raw-${stamp}.ps1`);
    fs.writeFileSync(binFile, toEscPos(content));
    fs.writeFileSync(scriptFile, PS_RAW_SCRIPT, 'utf8');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-PrinterName', printerName, '-FilePath', binFile], { timeout: 30000 }, (err) => {
      try { fs.unlinkSync(binFile); } catch { /* ignore */ }
      try { fs.unlinkSync(scriptFile); } catch { /* ignore */ }
      if (err) reject(err); else resolve();
    });
  });
}

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
      // Parâmetros vão por argv (-PrinterName/-FilePath), nunca interpolados
      // dentro do texto do script — não precisa (nem arrisca) escapar aspas.
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-PrinterName', printerName, '-FilePath', tmpFile],
        { timeout: 30000 },
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

function runCommand(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 30000 }, (err, stdout) => resolve(err ? null : stdout));
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
  nomesLocais = names;
  if (names.length > 0) {
    await rest('discovered_printers?on_conflict=store_id,name', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(names.map((name) => ({ store_id: storeId, name, machine: os.hostname(), updated_at: new Date().toISOString() }))),
    });
  }
  // Só apaga o que ESTA máquina publicou antes e não tem mais (impressora
  // desinstalada/desconectada aqui). Achado da revisão independente: a versão
  // anterior apagava tudo que não estivesse na lista local — com dois PCs na
  // mesma loja, cada um apagava as impressoras do outro a cada 60s, e um PC
  // sem impressora nenhuma limpava a lista inteira da loja.
  const sumiram = [...publicadasPorEstaMaquina].filter((n) => !names.includes(n));
  publicadasPorEstaMaquina = new Set(names);
  for (const nome of sumiram) {
    await rest(`discovered_printers?store_id=eq.${storeId}&name=eq.${encodeURIComponent(nome)}`, { method: 'DELETE' })
      .catch((e) => log(`WARN nao consegui remover a impressora sumida "${nome}": ${e.message}`));
  }
}

let redePublicadaPorEstaMaquina = new Set();

function sub24DasInterfaces() {
  const bases = new Set();
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const p = i.address.split('.');
      if (p[0] === '169') continue;
      bases.add(`${p[0]}.${p[1]}.${p[2]}`);
    }
  }
  return [...bases];
}

function portaAberta(ip, porta, timeoutMs) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let feito = false;
    const fim = (ok) => { if (feito) return; feito = true; sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => fim(true));
    sock.once('timeout', () => fim(false));
    sock.once('error', () => fim(false));
    sock.connect(porta, ip);
  });
}

// Varre cada /24 desta máquina procurando a porta 9100 (RAW/ESC-POS) aberta.
async function detectNetworkPrinters() {
  const meus = new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map((i) => i.address));
  const alvos = [];
  for (const base of sub24DasInterfaces()) for (let n = 1; n <= 254; n++) alvos.push(`${base}.${n}`);
  const achados = [];
  let idx = 0;
  const worker = async () => {
    while (idx < alvos.length) {
      const ip = alvos[idx++];
      if (meus.has(ip)) continue;
      if (await portaAberta(ip, 9100, 600)) achados.push(`${ip}:9100`);
    }
  };
  await Promise.all(Array.from({ length: 64 }, worker));
  const lista = achados.sort();
  const rotulos = {};
  await Promise.all(lista.map(async (nome) => {
    const ip = nome.split(':')[0];
    try {
      const hosts = await Promise.race([dns.reverse(ip), new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 1500))]);
      if (hosts && hosts[0]) rotulos[nome] = hosts[0].split('.')[0];
    } catch (_) { /* sem nome: fica só o IP */ }
  }));
  detectNetworkPrinters.ultimosRotulos = rotulos;
  return lista;
}

async function syncNetworkPrinters(storeId) {
  const nomes = await detectNetworkPrinters();
  if (nomes.length > 0) {
    await rest('discovered_printers?on_conflict=store_id,name', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(nomes.map((name) => ({ store_id: storeId, name, kind: 'network', label: detectNetworkPrinters.ultimosRotulos?.[name] || '', machine: os.hostname(), updated_at: new Date().toISOString() }))),
    });
  }
  const sumiram = [...redePublicadaPorEstaMaquina].filter((n) => !nomes.includes(n));
  redePublicadaPorEstaMaquina = new Set(nomes);
  for (const nome of sumiram) {
    await rest(`discovered_printers?store_id=eq.${storeId}&name=eq.${encodeURIComponent(nome)}&kind=eq.network`, { method: 'DELETE' })
      .catch((e) => log(`WARN nao consegui remover a impressora de rede sumida "${nome}": ${e.message}`));
  }
  log(`INFO varredura de rede: ${nomes.length} impressora(s) com a porta 9100 aberta`);
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

const normTokens = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Z0-9]+/).filter(Boolean);

// Nome da impressora NESTE computador: 1) mapa manual (machine_names),
// 2) o mesmo nome cadastrado, se existir aqui, 3) automático: uma única
// impressora local cujo nome contém a palavra-chave (ex. cadastro "pizzaria"
// / IMPPIZZARIA -> "PIZZARIA_PC-2" no notebook).
function resolverNomeLocal(printer, locais) {
  const lista = locais || nomesLocais;
  const eu = os.hostname().toLowerCase();
  const mapa = printer.machine_names || {};
  for (const k of Object.keys(mapa)) if (k.toLowerCase() === eu && mapa[k]) return mapa[k];
  if (printer.usb_system_name && lista.includes(printer.usb_system_name)) return printer.usb_system_name;
  const chaves = new Set([...normTokens(printer.name), ...normTokens(String(printer.usb_system_name || '').replace(/^IMP/i, ''))]);
  ['IMP', 'IMPRESSORA', 'PC', 'USB'].forEach((x) => chaves.delete(x));
  if (!chaves.size) return null;
  const achadas = lista.filter((n) => normTokens(n).some((t) => chaves.has(t)));
  return achadas.length === 1 ? achadas[0] : null;
}

async function printOnce(printer, content) {
  if (printer.connection_type === 'network') {
    await printViaNetwork(printer.ip_address, printer.port, content, printer.print_mode === 'raw');
  } else if (printer.connection_type === 'usb') {
    await (printer.print_mode === 'raw' ? printViaUsbRaw(printer.usb_system_name, content) : printViaUsb(printer.usb_system_name, content));
  } else {
    throw new Error(`Tipo de conexão não suportado aqui: ${printer.connection_type}`);
  }
}

// 1 retentativa: InvalidPrinterException do Windows aparece sobretudo logo
// depois da impressora ser reconfigurada e some sozinha em segundos. Sem
// isso virava 'error' permanente na fila (achado do agente original).
//
// Mas só repete quando é SEGURO repetir: erro de rede antes de mandar os
// bytes (`podeRepetir`). Erro depois do texto já ter saído nunca chega
// aqui — printViaNetwork resolve nesse caso (ver lá).
//
// USB nunca repete (achado ao vivo, loja Sertão, 2026-09-15): o teste saiu
// impresso 2x com só uma máquina/um app rodando — `Out-Printer` do
// PowerShell pode reportar erro DEPOIS de já ter mandado o conteúdo pro
// spooler do Windows (impressora térmica lenta pra confirmar), e não existe
// um `podeRepetir` confiável pra USB como existe pra socket de rede (não dá
// pra saber se o papel já saiu antes do erro). Repetir às cegas arrisca
// imprimir fisicamente 2x; falhar e deixar 'error' na fila (reenviável na
// aba Impressão) é sempre a escolha mais segura aqui.
// Job de cupom fiscal completo (PDF): conteúdo "@@PDF@@<url>". Só impressora
// USB (Windows): baixa o PDF e manda pro SumatraPDF, que imprime silencioso
// na impressora pelo nome (mesmo mecanismo do 'ntb-print-pdf-silent').
async function printPdfJob(printer, pdfUrl) {
  if (process.platform !== 'win32') throw new Error('Impressão de PDF só no Windows.');
  const sumatraPath = path.join(process.resourcesPath || path.join(__dirname, '..'), 'vendor', 'SumatraPDF.exe');
  if (!fs.existsSync(sumatraPath)) throw new Error('SumatraPDF.exe ausente no pacote instalado');
  const res = await fetch(pdfUrl);
  if (!res.ok) throw new Error(`Falha ao baixar o PDF (HTTP ${res.status})`);
  const tmpFile = path.join(os.tmpdir(), `ntb-cupom-fila-${Date.now()}.pdf`);
  fs.writeFileSync(tmpFile, Buffer.from(await res.arrayBuffer()));
  try {
    await new Promise((resolve, reject) => {
      execFile(sumatraPath, ['-print-to', printer.usb_system_name, '-print-settings', 'noscale', '-silent', '-exit-when-done', tmpFile], { timeout: 30000 },
        (err) => { if (err) reject(err); else resolve(); });
    });
  } finally {
    setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch { /* ignore */ } }, 15000);
  }
}

const LINHAS_MARGEM = 2;
const comMargem = (printer, content) => (printer && printer.bottom_margin && typeof content === 'string' && !content.startsWith('@@PDF@@'))
  ? `${content.replace(/\s+$/, '')}\n${'\n'.repeat(LINHAS_MARGEM)}.`
  : content;

async function printJob(printer, content) {
  content = comMargem(printer, content);
  if (typeof content === 'string' && content.startsWith('@@PDF@@')) {
    await printPdfJob(printer, content.slice(7).trim());
    return;
  }
  if (printer.connection_type !== 'network') {
    await printOnce(printer, content);
    return;
  }
  try {
    await printOnce(printer, content);
  } catch (firstErr) {
    if (!firstErr.podeRepetir) throw firstErr;
    log(`WARN 1a tentativa falhou (${firstErr.message}), tentando de novo em 2s`);
    await new Promise((r) => setTimeout(r, 2000));
    await printOnce(printer, content);
  }
}

function stop() {
  timers.forEach(clearInterval);
  timers = [];
  currentStoreId = null;
  // Invalida qualquer ciclo de impressão em voo (ver `geracao`).
  geracao += 1;
  publicadasPorEstaMaquina = new Set();
}

// Reserva o job para ESTA máquina. O `status=eq.pending` na condição é o que
// faz a reserva ser atômica: o PostgREST vira um `UPDATE ... WHERE id = ? AND
// status = 'pending'`, e o Postgres serializa as duas tentativas — a segunda
// não encontra mais nada pra atualizar e volta lista vazia.
//
// Sem isso (achado da revisão independente), dois computadores com o app
// aberto na mesma loja liam a mesma fila na mesma janela de 3s, os DOIS
// marcavam "printing" e os DOIS imprimiam: comanda dobrada na cozinha. Não
// era hipótese remota — com a impressão embutida no app, ter o app aberto em
// mais de um terminal é o caso normal, não a exceção.
// Marca o resultado da impressão, com 2 tentativas. Achado da revisão
// independente: se o PATCH de "done" falhasse DEPOIS do papel ter saído, o
// job voltava a ser lido como pendente 3s depois e era reimpresso pra
// sempre — impressora térmica cuspindo a mesma comanda em loop. Se nem
// assim gravar, deixa em `printing` (que ninguém reprocessa) em vez de
// arriscar o loop.
async function marcarJob(jobId, campos) {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      await rest(`print_jobs?id=eq.${jobId}`, { method: 'PATCH', body: JSON.stringify(campos) });
      return true;
    } catch (e) {
      log(`WARN nao consegui gravar o resultado do job (tentativa ${tentativa}): ${e.message}`);
      if (tentativa === 1) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  log(`ERROR job ${jobId} impresso mas sem conseguir gravar o status — fica como "imprimindo" pra NAO reimprimir sozinho`);
  return false;
}

async function reservarJob(jobId) {
  const res = await rest(`print_jobs?id=eq.${jobId}&status=eq.pending`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'printing' }),
  });
  const linhas = await res.json().catch(() => []);
  return Array.isArray(linhas) && linhas.length === 1;
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
  // nome da impressora -> computadores que a publicaram (discovered_printers).
  // Usado pelo plano B: se o computador dono da impressora USB não pegar o job,
  // outro computador da loja imprime pelo compartilhamento do Windows.
  let donosPorNome = new Map();
  const primeiraVez = new Map();

  const refreshPrinters = async () => {
    try {
      const data = await rest(
        `printer_configs?select=*&store_id=eq.${storeId}&is_active=eq.true&connection_type=in.(network,usb)`
      ).then((r) => r.json());
      printersById = new Map((Array.isArray(data) ? data : []).map((p) => [p.id, p]));
      const pub = await rest(`discovered_printers?select=name,machine&store_id=eq.${storeId}&kind=eq.system`).then((r) => r.json());
      const m = new Map();
      for (const r of Array.isArray(pub) ? pub : []) { if (!r.machine) continue; if (!m.has(r.name)) m.set(r.name, new Set()); m.get(r.name).add(r.machine); }
      donosPorNome = m;
    } catch (e) {
      log(`ERROR ao buscar impressoras: ${e.message}`);
    }
  };

  const minhaGeracao = geracao;
  let tickRunning = false;
  const tick = async () => {
    // Garante no máximo 1 tick por vez: dois Out-Printer simultâneos logo
    // depois de reconfigurar impressora derrubam os dois no Windows (achado
    // ao vivo do agente original, 2026-08-28). A checagem de geração impede
    // o outro caso do mesmo problema: um ciclo da loja ANTERIOR (logout /
    // troca de loja) continuar rodando junto com o da loja nova.
    if (tickRunning || printersById.size === 0 || minhaGeracao !== geracao) return;
    tickRunning = true;
    try {
      const ids = Array.from(printersById.keys()).join(',');
      const limiteIdade = new Date(Date.now() - IDADE_MAXIMA_JOB_MS).toISOString();
      const jobs = await rest(
        `print_jobs?select=*&store_id=eq.${storeId}&status=eq.pending&printer_config_id=in.(${ids})&created_at=gte.${limiteIdade}&order=created_at.asc&limit=20`
      ).then((r) => r.json());

      for (const job of Array.isArray(jobs) ? jobs : []) {
        if (minhaGeracao !== geracao) return; // trocou de loja no meio da fila
        const printer = printersById.get(job.printer_config_id);
        if (!printer) continue;
        // Impressora USB só imprime na máquina onde ela está pendurada. Sem
        // isso (achado da revisão independente), o PC da cozinha pegava o job
        // da impressora USB do caixa, o `Out-Printer` falhava porque aquele
        // nome não existe ali, e o job virava "erro" — a comanda NUNCA saía,
        // mesmo com a máquina certa disponível pra imprimir.
        let impressoraDoJob = printer;
        let viaCompartilhamento = false;
        const nomeLocal = printer.connection_type === 'usb' ? resolverNomeLocal(printer) : null;
        if (nomeLocal) impressoraDoJob = { ...printer, usb_system_name: nomeLocal };
        if (printer.connection_type === 'usb' && !nomeLocal && nomesLocais.length > 0) {
          // Plano B (pedido do dono: qualquer computador da loja imprime): se o
          // computador dono da impressora não pegou o job em ~15s, este
          // imprime pelo compartilhamento do Windows (\\dono\impressora).
          const dono = [...(donosPorNome.get(printer.usb_system_name) || [])].find((mq) => mq.toLowerCase() !== os.hostname().toLowerCase());
          if (!dono || process.platform !== 'win32') continue;
          if (!primeiraVez.has(job.id)) primeiraVez.set(job.id, Date.now());
          if (Date.now() - primeiraVez.get(job.id) < 15000) continue;
          impressoraDoJob = { ...printer, usb_system_name: `\\\\${dono}\\${printer.usb_system_name}` };
          viaCompartilhamento = true;
        }
        if (!(await reservarJob(job.id))) {
          log(`INFO "${job.title}" já foi pego por outro computador — ignorando`);
          continue;
        }
        log(`INFO imprimindo "${job.title}" em "${printer.name}"`);
        try {
          await printJob(impressoraDoJob, job.content);
          await marcarJob(job.id, { status: 'done', printed_at: new Date().toISOString() });
          primeiraVez.delete(job.id);
          log(viaCompartilhamento ? `INFO impresso OK via compartilhamento ${impressoraDoJob.usb_system_name}` : 'INFO impresso OK');
        } catch (printErr) {
          log(`ERROR falhou: ${printErr.message}`);
          // Impressora nem abriu (compartilhamento inexistente, nome errado): nada
          // foi mandado pro papel, então é seguro devolver à fila pro computador
          // certo imprimir; este só tenta de novo daqui a ~1 min.
          const nadaEnviado = /Impressora invalida|Nao abriu a impressora|Esta máquina não tem/i.test(String(printErr.message || ''));
          if (viaCompartilhamento && nadaEnviado) {
            primeiraVez.set(job.id, Date.now() + 45000);
            await marcarJob(job.id, { status: 'pending' });
            continue;
          }
          // Qualquer outro erro: nunca devolve à fila (o Windows pode acusar erro
          // DEPOIS de já ter mandado pro spooler; reenfileirar imprimiria em dobro).
          // Fica 'error', reenviável na aba Impressão.
          primeiraVez.delete(job.id);
          await marcarJob(job.id, { status: 'error', error_message: String(printErr.message || printErr) });
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
    syncNetworkPrinters(storeId).catch((e) => log(`WARN varredura de rede falhou: ${e.message}`));
    tick();
  });

  timers.push(setInterval(async () => {
    await refreshPrinters();
    await sendHeartbeat(storeId, printersById.size);
  }, HEARTBEAT_INTERVAL_MS));
  timers.push(setInterval(() => syncDiscoveredPrinters(storeId).catch(() => {}), DISCOVER_INTERVAL_MS));
  timers.push(setInterval(() => syncNetworkPrinters(storeId).catch(() => {}), 5 * 60 * 1000));
  timers.push(setInterval(tick, POLL_INTERVAL_MS));

  return { ok: true };
}

// Impressão USB/compartilhada direto (sem fila do servidor): usa o nome local se
// esta máquina tem a impressora; senão o compartilhamento do Windows do dono.
async function printDirectUsb(printer, content, donos) {
  content = comMargem(printer, content);
  if (!nomesLocais.length) { const n = await detectLocalPrinters(); if (n) nomesLocais = n; }
  const raw = printer.print_mode === 'raw';
  const local = resolverNomeLocal(printer);
  let alvo = local;
  if (!alvo) {
    const eu = os.hostname().toLowerCase();
    const dono = (donos || []).find((m) => m && m.toLowerCase() !== eu);
    if (!dono) throw new Error('Esta máquina não tem essa impressora');
    alvo = `\\\\${dono}\\${printer.usb_system_name}`;
  }
  return raw ? printViaUsbRaw(alvo, content) : printViaUsb(alvo, content);
}

async function listarImpressorasLocais() {
  const n = await detectLocalPrinters();
  if (n) nomesLocais = n;
  return { hostname: os.hostname(), impressoras: nomesLocais };
}

module.exports = { start, stop, detectNetworkPrinters, toEscPos, printDirectNetwork: printViaNetwork, printDirectUsb, listarImpressorasLocais, resolverNomeLocal };
