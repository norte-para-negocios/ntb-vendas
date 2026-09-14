import RootLayout, { metadata, viewport } from '@/app/layout';
import { NtbBridgeInit } from './NtbBridgeInit';

export { metadata, viewport };

// Não dá mais pra reexportar `default` puro (Task 1, Step 4) — precisamos
// injetar o bridge ANTES do conteúdo. RootLayout do projeto principal já
// envolve os children com <html>/<body>; aqui só acrescentamos o
// componente de inicialização como primeiro filho.
export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <RootLayout>
      <NtbBridgeInit />
      {children}
    </RootLayout>
  );
}
