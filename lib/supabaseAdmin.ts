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

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada nas env vars do servidor.');
  }
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://giiwtnddasminjxweohr.supabase.co',
    key,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return cached;
}
