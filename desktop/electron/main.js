const { app, BrowserWindow, Menu, protocol, net, shell, Notification } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

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
  autoUpdater.on('error', (err) => {
    // Rede instável/DNS fora do ar não pode derrubar o app — sem esse
    // listener, um erro do autoUpdater (um EventEmitter) sem handler
    // registrado lança e mata o processo principal.
    console.error('Falha ao verificar atualização:', err);
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
  });
  autoUpdater.checkForUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
