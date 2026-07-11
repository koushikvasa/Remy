import { supabase } from "./db";

/**
 * Coordinator directory + referral assignment (P6). All lookups degrade to null
 * on any error (e.g. before migration 0002 is applied) so the live call path
 * never breaks.
 */

export interface Coordinator {
  id: string;
  name: string;
  phone: string;
  active: boolean;
}

export interface EscalatedReferral {
  id: string;
  run_id: string | null;
  decision: string | null;
  assigned_to: string | null;
  patient_first_initial: string | null;
  patient_age: number | null;
  discipline_needed: string | null;
  payer_raw: string | null;
  zip: string | null;
  reason_code: string | null;
  callback_phone: string | null;
  source_id: string | null;
}

/** Deterministic short code from a referral id (e.g. "R-3F9A2C"). */
export function referralShortCode(referralId: string): string {
  return "R-" + referralId.replace(/-/g, "").slice(0, 6).toUpperCase();
}

export async function getCoordinatorById(
  id: string | null
): Promise<Coordinator | null> {
  if (!id) return null;
  try {
    const { data, error } = await supabase()
      .from("coordinators")
      .select("id, name, phone, active")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error(`[coordinators] by id: ${error.message}`);
      return null;
    }
    return (data as Coordinator | null) ?? null;
  } catch {
    return null;
  }
}

export async function getActiveCoordinator(): Promise<Coordinator | null> {
  try {
    const { data, error } = await supabase()
      .from("coordinators")
      .select("id, name, phone, active")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error(`[coordinators] active lookup: ${error.message}`);
      return null;
    }
    return (data as Coordinator | null) ?? null;
  } catch (err) {
    console.error(`[coordinators] active lookup: ${(err as Error).message}`);
    return null;
  }
}

/** Fetch a referral if it exists AND is still escalated (for the callout TwiML). */
export async function getEscalatedReferral(
  referralId: string
): Promise<EscalatedReferral | null> {
  if (!referralId) return null;
  try {
    // select("*") is forward-compatible: assigned_to/callout_at may not exist
    // until migration 0002 is applied; missing → undefined → treated as null.
    const { data, error } = await supabase()
      .from("referrals")
      .select("*")
      .eq("id", referralId)
      .maybeSingle();
    if (error) {
      console.error(`[coordinators] referral lookup: ${error.message}`);
      return null;
    }
    return (data as EscalatedReferral | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Idempotency claim: set callout_at only if it is currently null. Returns true
 * iff THIS call won the claim (so exactly one callout is placed per referral).
 */
export async function claimCallout(referralId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase()
      .from("referrals")
      .update({ callout_at: new Date().toISOString() })
      .eq("id", referralId)
      .is("callout_at", null)
      .select("id");
    if (error) {
      console.error(`[coordinators] claimCallout: ${error.message}`);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (err) {
    console.error(`[coordinators] claimCallout: ${(err as Error).message}`);
    return false;
  }
}

/** Idempotency claim for the source call-back (one notify per referral). */
export async function claimSourceNotify(referralId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase()
      .from("referrals")
      .update({ source_notified_at: new Date().toISOString() })
      .eq("id", referralId)
      .is("source_notified_at", null)
      .select("id");
    if (error) {
      console.error(`[coordinators] claimSourceNotify: ${error.message}`);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (err) {
    console.error(`[coordinators] claimSourceNotify: ${(err as Error).message}`);
    return false;
  }
}

export async function assignReferral(
  referralId: string,
  coordinatorId: string
): Promise<boolean> {
  const { error } = await supabase()
    .from("referrals")
    .update({ assigned_to: coordinatorId, assigned_at: new Date().toISOString() })
    .eq("id", referralId);
  if (error) {
    console.error(`[coordinators] assign: ${error.message}`);
    return false;
  }
  return true;
}
