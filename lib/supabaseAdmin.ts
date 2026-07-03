import { createClient } from '@supabase/supabase-js';

// Client com a service role key: ignora RLS por completo. Só pode ser
// importado de código que roda no servidor (Route Handlers em app/api/**),
// nunca de um Client Component nem de lib/api.ts (que roda no browser).
// Ao contrário de lib/supabaseClient.ts, não tem fallback hardcoded: a
// service role key nunca pode ir pro repositório.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://giiwtnddasminjxweohr.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
