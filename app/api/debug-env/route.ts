import { NextResponse } from 'next/server';

// Rota de diagnostico temporaria (2026-07-13) -- confirma em producao se as
// env vars do dual-write pro Contabo estao realmente visiveis no runtime,
// sem expor os valores. Remover depois de confirmado.
export async function GET() {
  return NextResponse.json({
    hasUrl: Boolean(process.env.NTB_FRIO_API_URL),
    hasKey: Boolean(process.env.NTB_FRIO_VENDAS_API_KEY),
    urlPrefix: process.env.NTB_FRIO_API_URL?.slice(0, 15) ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    deploymentUrl: process.env.VERCEL_URL ?? null,
  });
}
