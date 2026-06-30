import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://giiwtnddasminjxweohr.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_7iLDkCZ5Fp3KQWW0aQer2w_eN84SfST';

export const supabase = createClient(supabaseUrl, supabaseKey);

export const isSupabaseConfigured = () =>
  supabaseUrl !== '' && supabaseKey !== '';
