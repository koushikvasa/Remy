import { supabase } from "../db";

/**
 * capacity tool (REMY_SPEC.md §4) — are there open slots for the discipline?
 * Uses the most recent week_of row for that discipline. available=null means we
 * can't check yet (no discipline).
 */

export interface CapacityResult {
  available: boolean | null;
  openSlots: number | null;
}

export async function checkCapacity(
  discipline: string | null
): Promise<CapacityResult> {
  if (!discipline) return { available: null, openSlots: null };

  const { data, error } = await supabase()
    .from("capacity")
    .select("open_slots, week_of")
    .eq("discipline", discipline)
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`capacity lookup failed: ${error.message}`);
  if (!data) return { available: null, openSlots: null };

  const openSlots = data.open_slots ?? 0;
  return { available: openSlots > 0, openSlots };
}
