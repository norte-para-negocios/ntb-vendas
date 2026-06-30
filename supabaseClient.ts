import { createClient } from '@supabase/supabase-js';

// Credentials provided by the user
// NOTE: If you encounter authentication errors, please verify the "anon" key in your Supabase Dashboard > Project Settings > API.
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://oozoplkxjeygenyayaqv.supabase.co';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'sb_publishable_P3Uva0OovGfxf21EASlfSQ_jENN7clG';

export const supabase = createClient(supabaseUrl, supabaseKey);

export const isSupabaseConfigured = () => {
  // Always return true now that we have credentials, but check for validity
  return supabaseUrl !== '' && supabaseKey !== '';
};