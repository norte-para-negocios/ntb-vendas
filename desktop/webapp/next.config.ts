import type { NextConfig } from 'next';

// Build estático (sem servidor) — só pra estas 3 rotas. next/image exige
// unoptimized:true em modo export (a otimização de imagem normal precisa
// de um servidor rodando, que este bundle não tem).
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // Necessário pra gerar out/loja/index.html e out/painel/index.html (em vez
  // de loja.html/painel.html) — o shell Electron (Task 4) carrega via
  // file://, e index.html por pasta é o formato que Task 4 espera encontrar.
  trailingSlash: true,
};

export default nextConfig;
