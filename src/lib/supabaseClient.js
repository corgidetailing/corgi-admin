import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // This will show in the browser console
  console.error(
    "[supabaseClient] Missing env vars. You must set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in a .env file."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Helpful for UI diagnostics (do not show the anon key; just confirm a key exists)
 */
export function getSupabaseEnvInfo() {
  return {
    url: supabaseUrl || "(missing VITE_SUPABASE_URL)",
    anonKeyPresent: Boolean(supabaseAnonKey),
  };
}
