const { contextBridge } = require('electron');

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
});
