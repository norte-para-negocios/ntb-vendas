'use client';

import { useEffect } from 'react';

// Tela branca ao trocar de aba/tela (relatado pela loja em 2026-09-11 e
// confirmado por revisão independente em 2026-09-13): sem nenhum
// ErrorBoundary, um erro de render em qualquer componente desmonta a árvore
// inteira e o operador fica com a tela BRANCA, sem mensagem, sem botão, sem
// pista — no navegador e dentro do app desktop. Os handlers do Electron
// (render-process-gone/unresponsive/did-fail-load) não pegam este caso: o
// processo está vivo e a página responde.
//
// Aqui o React entrega o erro em vez de sumir com tudo: mostra o que houve,
// registra no console (fica no log do app desktop) e oferece "tentar de
// novo" (reset() remonta só a rota, sem perder a sessão) e "recarregar".
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[NTB] erro de render capturado pelo ErrorBoundary:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="max-w-md w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-lg)] p-6 text-center">
        <h1 className="text-lg font-bold text-[var(--text)] mb-2">A tela travou, mas nada foi perdido</h1>
        <p className="text-sm text-[var(--text-muted)] mb-1">
          Seus pedidos e sua conta continuam salvos no servidor. Toque abaixo pra voltar.
        </p>
        <p className="text-[11px] text-[var(--text-muted)] mb-5 select-text">
          Detalhe técnico: {error.message}{error.digest ? ` (${error.digest})` : ''}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => reset()}
            className="flex-1 h-11 rounded-[var(--r-md)] bg-[var(--brand)] text-white font-semibold"
          >
            Tentar de novo
          </button>
          <button
            onClick={() => window.location.reload()}
            className="flex-1 h-11 rounded-[var(--r-md)] border border-[var(--border)] text-[var(--text)] font-semibold"
          >
            Recarregar
          </button>
        </div>
      </div>
    </div>
  );
}
