const { app, BrowserWindow, Menu, protocol, net, shell, Notification, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

// Achado real (2026-09-10, pedido do dono: "a atualização não está
// funcionando"): antes disso, o único jeito de saber o que o
// autoUpdater fez numa loja era a Notification passageira (some sozinha,
// ninguém tira print às 7h da manhã) — sem log nenhum em disco, um
// problema real (rede, servidor de update fora do ar, instalador
// rejeitado) e um "não aconteceu nada porque já tá atualizado" eram
// indistinguíveis à distância. Log simples (sem dependência nova tipo
// electron-log) em texto, truncado se passar de 1MB pra nunca crescer
// sem limite — dá pra pedir pro dono da loja abrir esse arquivo (ou
// mandar print) quando desconfiar que não atualizou.
const UPDATE_LOG_PATH = path.join(app.getPath('userData'), 'update.log');
function logUpdate(msg) {
  try {
    if (fs.existsSync(UPDATE_LOG_PATH) && fs.statSync(UPDATE_LOG_PATH).size > 1_000_000) {
      fs.truncateSync(UPDATE_LOG_PATH, 0);
    }
    fs.appendFileSync(UPDATE_LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // Nunca deixar uma falha de log (disco cheio, permissão) derrubar a
    // atualização em si — o log é diagnóstico, não é crítico.
  }
}

// Achado real (QA, 2026-09-08): lojas com "envia pedido direto pra
// impressão" (order_flow: 'direct_print', ver AGENTS.md/CaixaPrintStation)
// disparam window.print() a cada pedido novo — no navegador normal isso já
// funciona sem fricção (impressora padrão memorizada), mas dentro do
// Electron abre o diálogo NATIVO de impressão do sistema operacional e
// TRAVA a janela até alguém clicar manualmente, quebrando exatamente o
// "imprime sozinho" que é a razão do PDV físico existir. `kiosk-printing`
// é um switch documentado do Chromium/Electron: com ele, window.print()
// imprime direto na impressora padrão do SO, sem diálogo nenhum — mesmo
// princípio já usado por apps de PDV/kiosk em produção. Precisa ser
// setado ANTES de app.whenReady().
//
// ⚠️ Ressalva verificada nesta sessão (testado no Mac de desenvolvimento,
// NÃO num Windows real — o único alvo de build deste app, ver package.json
// build.win): mesmo com uma impressora padrão configurada, o diálogo NATIVO
// do macOS continuou aparecendo com este switch ligado. Pesquisa confirma
// que esse é um limite conhecido do Chromium/Electron: no Windows/Linux, o
// diálogo que kiosk-printing suprime é o do PRÓPRIO Chromium; no macOS, a
// impressão passa pelo painel nativo da Apple, que o switch não controla.
// Como este app só builda pra Windows, o comportamento esperado lá é
// diferente do observado aqui — mas isso continua sendo uma pendência real
// de verificação numa máquina Windows física (mesma categoria de "só
// confirma num Windows de verdade" já registrada no plano do app desktop),
// não uma confirmação de que funciona.
app.commandLine.appendSwitch('kiosk-printing');

// Sem isso, rodar via `electron .` (modo dev, sem empacotar) mostra
// "Electron" no menu/dock/taskbar em vez do nome real — o .exe empacotado
// (electron-builder já usa `productName` do package.json pra isso) não tem
// esse problema, mas forçar aqui também deixa o app correto em qualquer
// cenário, sem depender de lembrar que só o build empacotado "conserta".
app.setName('Norte Vendas');
// Windows agrupa/rotula a janela na barra de tarefas pelo AppUserModelId,
// não pelo nome do processo — sem isso, builds sem instalador (portable/
// dev) podem aparecer como "electron.exe" na barra de tarefas do Windows.
app.setAppUserModelId('com.norteparanegocios.ntbvendas');

// Sem menu de navegador — "cara de PDV", não de app genérico.
Menu.setApplicationMenu(null);

const OUT_DIR = path.join(__dirname, '..', 'webapp', 'out');

// A exportação estática do Next (next.config.ts, output: 'export') emite
// caminhos de asset/navegação root-absolutos (ex.: href="/_next/static/
// chunks/x.js", href="/loja/") — carregados via win.loadFile() (file://),
// esses caminhos resolveriam contra a raiz do sistema de arquivos do SO,
// não contra a pasta do bundle, e nada carregaria. Registrar um protocolo
// próprio (app://) que serve os arquivos de OUT_DIR resolve isso: os
// caminhos absolutos passam a resolver contra a origem app://bundle/,
// exatamente como resolveriam contra a raiz de um domínio http normal.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    title: 'Norte Vendas',
    width: 1280,
    height: 800,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Preload roda sandboxed por padrão (Electron 20+, mesmo com
      // contextIsolation:true) — nesse modo `require()` só resolve um
      // punhado de módulos nativos (ex. 'electron'), NUNCA um arquivo
      // local por caminho relativo. `require('../package.json')` direto
      // no preload.js quebrava o script inteiro silenciosamente (sem
      // erro visível na tela), derrubando com ele o `contextBridge.
      // exposeInMainWorld` — não só a versão nova ficava faltando, a
      // MESMA falha também zerava `apiBaseUrl`, fazendo o app parecer
      // "funcionando" só porque caía direto no cache offline. Repassar a
      // versão como `additionalArguments` evita `require` de arquivo
      // local: preload.js lê de `process.argv`, que continua disponível
      // mesmo sandboxed.
      additionalArguments: [`--ntb-app-version=${app.getVersion()}`],
    },
  });

  win.loadURL('app://bundle/index.html');

  // Nunca abrir popup dentro do app (sem barra de navegação pra fechar) —
  // qualquer window.open/target=_blank vira uma aba no navegador padrão do
  // sistema operacional.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    // trailingSlash: true no Next.js (ver next.config.ts) faz todo link
    // gerado apontar pra "/rota/" (com barra) em vez de "/rota" — inclusive
    // a raiz "/". Sempre que o caminho terminar em barra, serve o
    // index.html daquele diretório.
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = path.join(OUT_DIR, pathname);
    // Guarda básica contra path traversal: o caminho resolvido precisa
    // continuar dentro de OUT_DIR.
    if (!path.resolve(filePath).startsWith(path.resolve(OUT_DIR))) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  createWindow();

  // Confere atualização ao abrir; baixa em background se houver, aplica
  // no próximo reinício (comportamento padrão do electron-updater, não
  // interrompe quem está no meio de uma venda). Pedido do dono
  // (2026-09-08): sempre dar um retorno rápido e visível de que o app
  // conferiu — "atualizado" quando já está na última versão, ou avisando
  // que baixou uma nova. `checkForUpdates()` (não `checkForUpdatesAndNotify`)
  // pra controlar a notificação nós mesmos, com as duas mensagens —
  // `checkForUpdatesAndNotify` só notifica no caso de update baixado.
  // electron-updater loga sozinho (checando/baixando/progresso/erro) em
  // qualquer objeto com .info/.warn/.error/.debug — plugado aqui pra
  // tudo cair no update.log, sem precisar instrumentar cada evento à mão.
  autoUpdater.logger = {
    info: (m) => logUpdate(`INFO ${m}`),
    warn: (m) => logUpdate(`WARN ${m}`),
    error: (m) => logUpdate(`ERROR ${m}`),
    debug: (m) => logUpdate(`DEBUG ${m}`),
  };
  // Explícitos mesmo sendo o default do electron-updater — clareza de
  // intenção: baixa sozinho ao achar update, aplica sozinho quando o app
  // fechar (nunca interrompe o app rodando, nunca precisa clique manual).
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    // Rede instável/DNS fora do ar não pode derrubar o app — sem esse
    // listener, um erro do autoUpdater (um EventEmitter) sem handler
    // registrado lança e mata o processo principal. Sem Notification aqui
    // de propósito: rede de loja cai e volta o tempo todo, e um popup a
    // cada tentativa falha seria só ruído — fica só no log.
    logUpdate(`ERROR (evento) ${err?.stack || err}`);
  });
  autoUpdater.on('update-not-available', () => {
    new Notification({
      title: 'Norte Vendas',
      body: `Atualizado (v${app.getVersion()})`,
    }).show();
  });
  autoUpdater.on('update-downloaded', (info) => {
    new Notification({
      title: 'Norte Vendas',
      body: `Nova versão baixada (v${info.version}) — será aplicada ao reabrir o app.`,
    }).show();
    // Pedido direto do dono (2026-09-10): a Notification acima é
    // passageira e macOS/Windows podem suprimi-la (foco ocupado,
    // "não perturbe") — sem nenhum jeito de saber, de olho na tela, que
    // tem atualização esperando. Manda pra TODAS as janelas abertas um
    // aviso que fica na tela até alguém agir (ver
    // components/DesktopUpdateBanner.tsx): "Atualizar agora" chama
    // `quitAndInstall()` na hora (o app fecha e reabre já atualizado);
    // "Depois" só esconde o banner até o próximo reinício — a instalação
    // automática ao fechar (autoInstallOnAppQuit) continua garantida de
    // qualquer forma, o botão só existe pra quem quer atualizar JÁ, sem
    // esperar sozinho fechar o app sem saber se vai mesmo aplicar.
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('ntb-update-downloaded', { version: info.version });
    }
  });
  autoUpdater.checkForUpdates();

  // Chamado pelo botão "Atualizar agora" do banner (ver preload.js/
  // DesktopUpdateBanner.tsx). `quitAndInstall()` fecha o app e roda o
  // instalador NSIS silenciosamente — reabre sozinho na versão nova.
  ipcMain.handle('ntb-install-update', () => {
    logUpdate('INFO Instalação solicitada manualmente pelo botão "Atualizar agora"');
    autoUpdater.quitAndInstall();
  });

  // Achado real: um PDV de restaurante fica ligado o turno inteiro (às
  // vezes dias, se ninguém desliga o PC) — checar só uma vez ao abrir o
  // app significa que uma loja que raramente reinicia o app pode nunca
  // perceber que existe atualização nova. Recheca a cada 4h enquanto o
  // app estiver aberto; `autoInstallOnAppQuit` continua garantindo que a
  // instalação em si só acontece quando o app fechar, nunca no meio do
  // expediente.
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
