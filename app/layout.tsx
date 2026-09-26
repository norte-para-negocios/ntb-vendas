import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider } from '@/context/AppContext';
import { ToastViewport } from '@/components/Toast';
import { ConfirmDialogRoot } from '@/components/ConfirmDialog';
import { AlertDialogRoot } from '@/components/AlertDialog';
import { THEME_INIT_SCRIPT } from '@/components/ThemeToggle';
import { DesktopUpdateBanner } from '@/components/DesktopUpdateBanner';

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
  // viewport-fit=cover: sem isso todo env(safe-area-inset-*) vale 0 e a barra
  // inferior/carrinho encostam no gesto de home do iPhone (auditoria 2026-09-23).
  viewportFit: 'cover',
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
          href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;700&family=Kalam:wght@400;700&family=Quicksand:wght@500;700&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root {
            /* Fonte do sistema (redesign estilo Apple, 2026-09-26): SF no Mac,
               Segoe UI Variable no Windows das lojas. */
            --font-sans-src: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
            --font-mono-src: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
          }
        `}</style>
      </head>
      <body className="min-h-full antialiased">
        <AppProvider>{children}</AppProvider>
        <ToastViewport />
        <ConfirmDialogRoot />
        <AlertDialogRoot />
        <DesktopUpdateBanner />
      </body>
    </html>
  );
}
