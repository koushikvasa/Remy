import { supabase } from "../db";

/**
 * serviceArea tool (REMY_SPEC.md §4) — is the patient's ZIP in our service area?
 * Pure DB lookup. covered=null means we can't check yet (no ZIP).
 */

export interface ServiceAreaResult {
  covered: boolean | null;
  county: string | null;
}

export async function checkServiceArea(
  zip: string | null
): Promise<ServiceAreaResult> {
  if (!zip) return { covered: null, county: null };

  const { data, error } = await supabase()
    .from("service_areas")
    .select("zip, county, active")
    .eq("zip", zip)
    .maybeSingle();

  if (error) throw new Error(`serviceArea lookup failed: ${error.message}`);
  if (!data) return { covered: false, county: null }; // ZIP known but not listed = out of area

  return { covered: data.active !== false, county: data.county ?? null };
}
