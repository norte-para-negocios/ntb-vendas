import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://oozoplkxjeygenyayaqv.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_P3Uva0OovGfxf21EASlfSQ_jENN7clG';

export const supabase = createClient(supabaseUrl, supabaseKey);

export const isSupabaseConfigured = () =>
  supabaseUrl !== '' && supabaseKey !== '';
