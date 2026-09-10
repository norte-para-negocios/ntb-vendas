const { contextBridge } = require('electron');
const { version } = require('../package.json');

// Exposto como window.electronApp na página carregada — é isso que
// lib/api.ts:resolverUrlApi() lê pra decidir se resolve /api/* pra URL
// absoluta. contextIsolation:true (setado em main.js) garante que a
// página não pode alterar isso depois de carregada.
contextBridge.exposeInMainWorld('electronApp', {
  isElectron: true,
  apiBaseUrl: 'https://testvendase.norteparanegocios.com.br',
  // `version` do próprio package.json do desktop (o mesmo que
  // electron-builder usa pro nome do instalador/latest.yml) — mostrado na
  // sidebar do painel do lojista pra dar pro dono/equipe um jeito de
  // conferir na hora qual build está rodando numa loja específica, sem
  // precisar abrir o instalador ou perguntar pro suporte.
  version,
});
