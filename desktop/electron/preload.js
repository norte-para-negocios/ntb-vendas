const { contextBridge } = require('electron');

// Exposto como window.electronApp na página carregada — é isso que
// lib/api.ts:resolverUrlApi() lê pra decidir se resolve /api/* pra URL
// absoluta. contextIsolation:true (setado em main.js) garante que a
// página não pode alterar isso depois de carregada.
contextBridge.exposeInMainWorld('electronApp', {
  isElectron: true,
  apiBaseUrl: 'https://testvendase.norteparanegocios.com.br',
});
