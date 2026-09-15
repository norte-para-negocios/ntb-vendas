import RootLayout, { metadata as baseMetadata, viewport } from '@/app/layout';
import { NtbBridgeInit } from './NtbBridgeInit';
import mobilePackageJson from '../../package.json';

// Task 9: injeta a versão real do app mobile (mobile/package.json, NÃO o
// package.json da raiz — este é o do Next principal, sem relação com o
// app empacotado) como <meta name="ntb-app-version"> extra no <head>. É
// esse meta tag que o NtbBridgeInit (Task 2) lê pra popular
// window.electronApp.version — sem isso o app instalado sempre reportaria
// "0.0.0-dev" mesmo depois de empacotado de verdade.
export const metadata = {
  ...baseMetadata,
  other: { 'ntb-app-version': mobilePackageJson.version },
};
export { viewport };

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
