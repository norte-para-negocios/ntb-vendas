import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/context/AppContext';

export const metadata: Metadata = {
  title: 'Cardápio Digital',
  description: 'Sistema completo de cardápio digital, pedidos e cozinha.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full bg-gray-50 text-slate-800 antialiased">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
