'use client';

import { useEffect } from 'react';
import { registerPlugin } from '@capacitor/core';

// Assinatura do plugin nativo Kotlin (Task 4,
// mobile/android/.../printer/NtbPrinterPlugin.kt). `getStatus` diz qual
// driver o app escolheu pro aparelho atual ("sunmi"/"bluetooth"/
// "unsupported") — "unsupported" é o valor CORRETO em qualquer aparelho
// que não seja Sunmi nem tenha impressora Bluetooth pareada (ex.: o
// próprio emulador, que reporta fabricante "Google").
interface NtbPrinterPlugin {
  getStatus(): Promise<{ driver: string; manufacturer: string; available: boolean }>;
  printText(opts: { text: string }): Promise<{ success: boolean; message?: string }>;
}

const NtbPrinter = registerPlugin<NtbPrinterPlugin>('NtbPrinter');

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

    // Ponte de impressão nativa de verdade (Task 4) — substitui o
    // placeholder `{}` que existia aqui antes. `registerPlugin` do
    // Capacitor já resolve pro plugin nativo real dentro do app Android; no
    // navegador solto (sem casca nativa) cai no proxy web padrão do
    // Capacitor, que rejeita a chamada — mesma resiliência que
    // `window.electronApp` já tem.
    (window as any).ntbPrinter = NtbPrinter;
  }, []);

  return null;
}
