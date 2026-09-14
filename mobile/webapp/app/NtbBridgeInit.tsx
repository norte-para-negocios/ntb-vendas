'use client';

import { useEffect } from 'react';

// Mesmo truque do preload.js do app desktop (Electron): `lib/api.ts` já lê
// `window.electronApp?.isElectron`/`apiBaseUrl` pra resolver rota de API e
// mostrar a versão na sidebar — reaproveitar esse MESMO shape aqui evita
// qualquer mudança em lib/api.ts. `isElectron: true` é proposital (não
// criamos uma flag nova tipo `isAndroid`): o app web só faz UMA pergunta
// hoje — "estou rodando embutido numa casca nativa, ou no navegador
// solto?" — e a resposta é a mesma nos dois casos (usar apiBaseUrl
// absoluto em vez de caminho relativo).
//
// Roda num useEffect (não script inline no <head>) porque a página
// hidrata rápido o bastante aqui — diferente do preload do Electron, que
// PRECISA rodar antes de qualquer script da página (é código de outro
// processo, isolado). Aqui é tudo o mesmo processo JS.
export function NtbBridgeInit() {
  useEffect(() => {
    (window as any).electronApp = {
      isElectron: true,
      apiBaseUrl: 'https://testvendase.norteparanegocios.com.br',
      // Versão do app (não do bundle web) — lida do <meta> injetado no
      // build (ver Task 9, Step 3). Sem o <meta>, cai num valor visível
      // de "não configurado" em vez de undefined silencioso.
      version: document.querySelector('meta[name="ntb-app-version"]')?.getAttribute('content') || '0.0.0-dev',
    };

    // Placeholder pra impressão nativa — implementado de verdade na Task 4
    // (ponte Capacitor com a maquininha/impressora térmica). Existir desde
    // já evita checagens tipo `window.ntbPrinter &&` quebrarem por
    // `undefined` em código que testar a presença da ponte antes da Task 4.
    (window as any).ntbPrinter = (window as any).ntbPrinter || {};
  }, []);

  return null;
}
