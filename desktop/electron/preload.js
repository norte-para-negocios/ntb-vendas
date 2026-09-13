const { contextBridge, ipcRenderer } = require('electron');

// Preload roda sandboxed (Electron 20+) — `require('../package.json')`
// (arquivo local) não resolve aqui, só módulos nativos como 'electron'.
// A versão vem de `--ntb-app-version=` em `additionalArguments`
// (main.js), lido de `process.argv` (disponível mesmo sandboxed).
const versionArg = process.argv.find((a) => a.startsWith('--ntb-app-version='));
const version = versionArg ? versionArg.split('=')[1] : undefined;

// Exposto como window.electronApp na página carregada — é isso que
// lib/api.ts:resolverUrlApi() lê pra decidir se resolve /api/* pra URL
// absoluta. contextIsolation:true (setado em main.js) garante que a
// página não pode alterar isso depois de carregada.
contextBridge.exposeInMainWorld('electronApp', {
  isElectron: true,
  apiBaseUrl: 'https://testvendase.norteparanegocios.com.br',
  // Mostrado na sidebar do painel do lojista pra dar pro dono/equipe um
  // jeito de conferir na hora qual build está rodando numa loja
  // específica, sem precisar abrir o instalador ou perguntar pro suporte.
  version,
  // Ver DesktopUpdateBanner.tsx: `onUpdateDownloaded` assina o evento que
  // main.js manda quando uma atualização termina de baixar sozinha;
  // `installUpdate` chama `quitAndInstall()` do lado do processo
  // principal (não dá pra chamar autoUpdater direto do renderer).
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('ntb-update-downloaded', (_event, info) => callback(info));
  },
  installUpdate: () => ipcRenderer.invoke('ntb-install-update'),
  // Pergunta o estado da atualização em vez de depender de ter ouvido o
  // evento acima na hora exata (ver main.js) — e permite procurar
  // atualização na hora, sem esperar a checagem automática de 4 em 4h.
  getUpdateStatus: () => ipcRenderer.invoke('ntb-update-status'),
  checkForUpdate: () => ipcRenderer.invoke('ntb-check-update'),
  // Impressão de rede (IP) / USB direto pelo app, sem programa separado
  // (ver print-engine.js). Quem sabe QUAL loja está logada é o renderer
  // (a sessão vive no localStorage dele), e a URL/chave do Supabase são
  // as do próprio bundle — por isso quem inicia é o renderer, passando
  // as três coisas; o processo principal nunca precisa adivinhar loja
  // nem guardar config em arquivo, que era exatamente o config.json/slug
  // digitado à mão do agente separado.
  startPrintEngine: (params) => ipcRenderer.invoke('ntb-start-print-engine', params),
  stopPrintEngine: () => ipcRenderer.invoke('ntb-stop-print-engine'),
});
