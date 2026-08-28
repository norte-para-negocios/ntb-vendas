import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider } from '@/context/AppContext';
import { ToastViewport } from '@/components/Toast';
import { ConfirmDialogRoot } from '@/components/ConfirmDialog';
import { AlertDialogRoot } from '@/components/AlertDialog';
import { THEME_INIT_SCRIPT } from '@/components/ThemeToggle';

export const metadata: Metadata = {
  title: 'Cardápio Digital',
  description: 'Sistema completo de cardápio digital, pedidos e cozinha.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#484DB5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Fase 5, Task 18: 3 fontes de destaque a mais, uma por preset de
            identidade visual do cardápio do cliente (lib/theme.ts) — carregadas
            aqui (link compartilhado por todo o app) porque não há como
            injetar um <link> por loja num layout raiz estático; o custo de
            rede é o mesmo request a mais de sempre, só com mais famílias. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=JetBrains+Mono:wght@400;500&family=Fredoka:wght@500;700&family=Kalam:wght@400;700&family=Quicksand:wght@500;700&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root {
            /* Atkinson Hyperlegible: mesma fonte do site institucional
               norteparanegocios.com.br (humanista, alta legibilidade). */
            --font-sans-src: 'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            --font-mono-src: 'JetBrains Mono', 'Courier New', monospace;
          }
        `}</style>
      </head>
      <body className="min-h-full antialiased">
        <AppProvider>{children}</AppProvider>
        <ToastViewport />
        <ConfirmDialogRoot />
        <AlertDialogRoot />
      </body>
    </html>
  );
}
