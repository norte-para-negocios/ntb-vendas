import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://giiwtnddasminjxweohr.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_7iLDkCZ5Fp3KQWW0aQer2w_eN84SfST';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Exportados pra `lib/offline/network.ts` montar o próprio ping de
// conectividade contra o gateway do Supabase (que já responde com CORS
// liberado pra qualquer origem, ao contrário da raiz do site) — nunca
// hardcodar essa URL/key de novo em outro arquivo.
export const supabaseUrlForConnectivityCheck = supabaseUrl;
export const supabaseKeyForConnectivityCheck = supabaseKey;

export const isSupabaseConfigured = () =>
  supabaseUrl !== '' && supabaseKey !== '';
