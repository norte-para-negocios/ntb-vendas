import type { NextConfig } from 'next';

// Build estático — Capacitor serve os arquivos de dentro do WebView via
// file:// (scheme customizado `capacitor://`, na prática), igual ao app
// desktop serve via `app://`. Sem servidor rodando dentro do celular.
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
