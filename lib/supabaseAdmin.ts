import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Client com a service role key: ignora RLS por completo. Só pode ser
// importado de código que roda no servidor (Route Handlers em app/api/**),
// nunca de um Client Component nem de lib/api.ts (que roda no browser).
// Ao contrário de lib/supabaseClient.ts, não tem fallback hardcoded: a
// service role key nunca pode ir pro repositório.
//
// Criação sob demanda (não no topo do módulo): o Next.js carrega este
// arquivo durante o build (fase "Collecting page data") pra analisar as
// rotas, mesmo sem nenhuma requisição real acontecer. Criar o client direto
// no import faz `createClient(...)` rodar nesse momento também, e sem a
// env var configurada na Vercel isso derruba o build inteiro com
// "supabaseKey is required" (já aconteceu, ver histórico de deploy).
// Adiando pra dentro de uma função, o erro só acontece se a rota for
// chamada de verdade sem a variável, não trava o build de todo o site.
let cached: SupabaseClient | null = null;

// `actorHeader` (cabeçalho X-NTB-Actor recebido da requisição do app): o cliente devolvido o repassa ao banco, e os
// triggers de auditoria (migration 163) gravam QUEM fez a mudança em vez de "(sem login)". Sem ator = cliente compartilhado.
export function getSupabaseAdmin(actorHeader?: string | null): SupabaseClient {
  if (actorHeader && /^[A-Za-z0-9+/=]{8,2000}$/.test(actorHeader)) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada nas env vars do servidor.');
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://testvendase.norteparanegocios.com.br',
      key,
      { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { 'x-ntb-actor': actorHeader } } }
    );
  }
  if (cached) return cached;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada nas env vars do servidor.');
  }
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://testvendase.norteparanegocios.com.br',
    key,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return cached;
}
