import { supabase } from "../db";

/**
 * callerLookup tool (REMY_SPEC.md §4/§9) — phone (E.164) → referral source.
 * Used by the /twiml webhook to personalize the greeting before the call
 * connects. Returns null on no match or any error (greeting falls back to the
 * generic form — never block the call).
 */

export interface CallerSource {
  id: string;
  org_name: string;
  contact_name: string | null;
  org_type: string | null;
}

export async function lookupCaller(phone: string | null): Promise<CallerSource | null> {
  if (!phone) return null;

  const { data, error } = await supabase()
    .from("referral_sources")
    .select("id, org_name, contact_name, org_type")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    console.error(`[callerLookup] failed for ${phone}: ${error.message}`);
    return null;
  }
  return (data as CallerSource | null) ?? null;
}
