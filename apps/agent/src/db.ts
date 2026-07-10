import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client (agent side) — service role, bypasses RLS (REMY_SPEC.md §5).
 * Lazy so importing modules that touch the DB never requires creds until a call
 * actually runs.
 */

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see apps/agent/.env)."
      );
    }
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
