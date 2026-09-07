const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Sem menu de navegador — "cara de PDV", não de app genérico.
Menu.setApplicationMenu(null);

function createWindow() {
  const win = new BrowserWindow({
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

  const indexPath = path.join(__dirname, '..', 'webapp', 'out', 'index.html');
  win.loadFile(indexPath);

  return win;
}

app.whenReady().then(() => {
  createWindow();

  // Confere atualização ao abrir; baixa em background se houver, aplica
  // no próximo reinício (comportamento padrão do electron-updater, não
  // interrompe quem está no meio de uma venda).
  autoUpdater.checkForUpdatesAndNotify();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
