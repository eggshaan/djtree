import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Cloud mode is on only when both env vars are present. With them absent the app
 * runs exactly as before against the local Express + SQLite backend, so the
 * offline setup never becomes collateral damage of the hosted one.
 */
export const cloudMode = Boolean(url && key);

export const supabase: SupabaseClient | null = cloudMode
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/** Narrows the nullable client for the cloud-only code paths. */
export function client(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}
