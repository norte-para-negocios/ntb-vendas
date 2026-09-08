const { app, BrowserWindow, Menu, protocol, net, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

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
  // interrompe quem está no meio de uma venda).
  autoUpdater.on('error', (err) => {
    // Rede instável/DNS fora do ar não pode derrubar o app — sem esse
    // listener, um erro do autoUpdater (um EventEmitter) sem handler
    // registrado lança e mata o processo principal.
    console.error('Falha ao verificar atualização:', err);
  });
  autoUpdater.checkForUpdatesAndNotify();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
