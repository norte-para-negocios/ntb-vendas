import { NextRequest, NextResponse } from 'next/server';

// Achado real (QA do app desktop Electron, 2026-09-07): toda chamada a
// /api/* feita de dentro do app desktop (ver desktop/electron/preload.js)
// é CROSS-ORIGIN de verdade — a página roda em app://bundle, não em
// https://testvendase.norteparanegocios.com.br, mesmo com resolverUrlApi()
// (lib/api.ts) já resolvendo pra URL absoluta certa. Nenhuma rota em
// app/api/** manda Access-Control-Allow-Origin, então o Chromium (dentro
// do Electron) bloqueia a leitura da resposta com "TypeError: Failed to
// fetch" — reproduzido de verdade clicando "Iniciar Preparo" no KDS
// (dispara triggerPushForOrder → /api/push/send). Afeta em tese TODA rota
// /api/*, não só push — inclusive emissão fiscal automática
// (/api/fiscal/emitir), que é a mais crítica.
//
// `middleware.ts` foi renomeado pra `proxy.ts` no Next.js 16 (mesmo achado
// já registrado no AGENTS.md do ntb-estoque) — nome do arquivo importa,
// a API (NextRequest/NextResponse, `config.matcher`) continua a mesma.
//
// Escopo deliberadamente restrito: só libera CORS pra origem `app://bundle`
// (o app desktop) e só em `/api/*` — nunca um `Access-Control-Allow-Origin: *`
// genérico, que abriria essas rotas (algumas com service role key por trás)
// pra qualquer site da internet fazer fetch cross-origin.
const ALLOWED_ORIGIN = 'app://bundle';

function withCorsHeaders(res: NextResponse, origin: string | null) {
  if (origin === ALLOWED_ORIGIN) {
    res.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  return res;
}

export default function proxy(req: NextRequest) {
  const origin = req.headers.get('origin');

  // Preflight: o browser manda OPTIONS antes do POST/PUT de verdade quando
  // o body não é "simple" (ex.: Content-Type: application/json, o caso de
  // toda rota deste projeto). Nenhuma rota em app/api/** exporta um handler
  // OPTIONS, então sem isso o Next devolveria 405 antes do preflight passar.
  if (req.method === 'OPTIONS') {
    return withCorsHeaders(new NextResponse(null, { status: 204 }), origin);
  }

  return withCorsHeaders(NextResponse.next(), origin);
}

export const config = {
  matcher: '/api/:path*',
};
