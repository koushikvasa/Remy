import { Decision } from "@remy/shared";
import { supabase } from "./db";
import { redactText } from "./redact";
import type { Session } from "./session";

/**
 * referrals.ts — the mock EMR write-back (REMY_SPEC.md §5/§7). On CLOSING we
 * write one referrals row per call: accepted rows and escalated rows both land
 * here so the dashboard queue shows everything, pre-filled.
 *
 * Note: referrals is the referral record (initial + age only, never a full name),
 * so it may hold clinical detail. The PHI redaction gate is for run_events.
 */

// Decision.decision (accept|escalate|decline) → referrals.decision (past tense).
const DECISION_DB: Record<Decision["decision"], string> = {
  accept: "accepted",
  escalate: "escalated",
  decline: "declined",
};

function transcriptSummary(session: Session): string {
  const d = session.draft;
  const line = `Referral: ${d.patient_age ?? "?"}yo initial ${
    d.patient_first_initial ?? "?"
  }, ${d.diagnosis_summary ?? "?"}, ${d.discipline_needed ?? "?"}, payer ${
    d.payer_raw ?? "?"
  }, ZIP ${d.zip ?? "?"}, start ${d.requested_start ?? "?"}.`;
  return redactText(line);
}

export async function writeReferral(
  session: Session,
  decision: Decision
): Promise<string | null> {
  const d = session.draft;

  const { data, error } = await supabase()
    .from("referrals")
    .insert({
      run_id: session.runId,
      source_id: session.sourceId,
      patient_first_initial: d.patient_first_initial,
      patient_age: d.patient_age,
      diagnosis_summary: d.diagnosis_summary,
      discipline_needed: d.discipline_needed,
      payer_raw: d.payer_raw,
      payer_matched_id: session.payerMatchedId,
      zip: d.zip,
      requested_start: d.requested_start,
      decision: DECISION_DB[decision.decision],
      reason_code: decision.reason_code,
      transcript_summary: transcriptSummary(session),
      callback_phone: session.callbackPhone,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error(`[referrals] writeReferral failed (run ${session.runId}): ${error?.message}`);
    return null;
  }
  return data.id as string;
}
