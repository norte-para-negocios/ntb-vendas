'use client';

// Anteparo final: erro no PRÓPRIO layout raiz não é pego por app/error.tsx.
// Precisa trazer <html>/<body> porque substitui o layout inteiro. Sem
// estilo do design system aqui de propósito — se o layout raiz quebrou, os
// tokens de tema podem não ter carregado.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>O aplicativo precisou reiniciar a tela</h1>
        <p style={{ fontSize: 14, color: '#666' }}>Seus dados continuam salvos no servidor.</p>
        <p style={{ fontSize: 11, color: '#999' }}>{error.message}{error.digest ? ` (${error.digest})` : ''}</p>
        <button onClick={() => reset()} style={{ marginTop: 16, padding: '12px 20px', fontSize: 15, borderRadius: 8 }}>
          Tentar de novo
        </button>
      </body>
    </html>
  );
}
