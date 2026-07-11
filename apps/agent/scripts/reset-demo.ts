import "dotenv/config";
import { supabase } from "../src/db";
import { redactPayload } from "../src/redact";

/**
 * reset-demo.ts — reset the Remy DB to a clean, demo-ready state.
 *
 * Clears runs / run_events / referrals, then seeds ONE accepted and ONE
 * escalated referral (with runs + a believable event trace) so the dashboard
 * queue and trace pages look lived-in before the demo call. Prints the state.
 *
 *   pnpm --filter @remy/agent reset
 *
 * Targets the Remy project only (apps/agent/.env service role).
 */

async function main(): Promise<void> {
  const db = supabase();

  // 1. Clear — children (FK) before parents.
  await db.from("run_events").delete().gte("created_at", "1970-01-01T00:00:00Z");
  await db.from("referrals").delete().gte("created_at", "1970-01-01T00:00:00Z");
  await db.from("runs").delete().gte("started_at", "1970-01-01T00:00:00Z");
  console.log("cleared runs / run_events / referrals");

  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  // 2a. Accepted run.
  const { data: runA, error: eA } = await db
    .from("runs")
    .insert({
      caller_phone: "+12125550142",
      status: "completed",
      started_at: iso(12 * 60000),
      ended_at: iso(12 * 60000 - 42000),
    })
    .select("run_id")
    .single();
  if (eA || !runA) throw new Error(`seed run A failed: ${eA?.message}`);

  // 2b. Escalated run.
  const { data: runB, error: eB } = await db
    .from("runs")
    .insert({
      caller_phone: "+19735550188",
      status: "escalated",
      started_at: iso(5 * 60000),
      ended_at: iso(5 * 60000 - 55000),
    })
    .select("run_id")
    .single();
  if (eB || !runB) throw new Error(`seed run B failed: ${eB?.message}`);

  // 3. Referrals (the mock EMR queue).
  await db.from("referrals").insert([
    {
      run_id: runA.run_id,
      patient_first_initial: "M",
      patient_age: 78,
      diagnosis_summary: "CHF exacerbation",
      discipline_needed: "RN",
      payer_raw: "Medicare",
      zip: "07081",
      requested_start: "tomorrow",
      decision: "accepted",
      reason_code: "ALL_CLEAR",
      transcript_summary:
        "Referral: 78yo initial M, CHF exacerbation, RN, payer Medicare, ZIP 07081, start tomorrow.",
      created_at: iso(12 * 60000 - 42000),
    },
    {
      run_id: runB.run_id,
      patient_first_initial: "R",
      patient_age: 66,
      diagnosis_summary: "post-op knee rehab",
      discipline_needed: "PT",
      payer_raw: "UnitedHealthcare Medicare Advantage",
      zip: "07090",
      requested_start: "Monday",
      decision: "escalated",
      reason_code: "PAYER_NOT_ACCEPTED",
      callback_phone: "2015550199",
      transcript_summary:
        "Referral: 66yo initial R, post-op knee rehab, PT, payer UnitedHealthcare Medicare Advantage, ZIP 07090, start Monday.",
      created_at: iso(5 * 60000 - 55000),
    },
  ]);

  // 4. Event traces (PHI-safe; run through the redaction gate for consistency).
  const draftA = {
    patient_first_initial: "M",
    patient_age: 78,
    diagnosis_summary: "CHF exacerbation",
    discipline_needed: "RN",
    payer_raw: "Medicare",
    zip: "07081",
    requested_start: "tomorrow",
  };
  const evA = [
    { seq: 1, stage: "GREETING", sub_agent: "system", tool_name: null, latency_ms: null, confidence: null, payload: { event: "greeting_sent" } },
    { seq: 2, stage: "COLLECTING", sub_agent: "extractor", tool_name: null, latency_ms: 1600, confidence: 1, payload: { updated_fields: Object.keys(draftA), draft: draftA } },
    { seq: 3, stage: "READBACK", sub_agent: "responder", tool_name: null, latency_ms: null, confidence: null, payload: { kind: "readback" } },
    { seq: 4, stage: "DECIDING", sub_agent: "fitchecker", tool_name: "serviceArea", latency_ms: 80, confidence: null, payload: { result: { covered: true, county: "Union" } } },
    { seq: 5, stage: "DECIDING", sub_agent: "fitchecker", tool_name: "payer", latency_ms: 120, confidence: null, payload: { result: { accepted: true, matchedName: "Medicare" } } },
    { seq: 6, stage: "DECIDING", sub_agent: "fitchecker", tool_name: "capacity", latency_ms: 110, confidence: null, payload: { result: { available: true, openSlots: 4 } } },
    { seq: 7, stage: "DECIDING", sub_agent: "decider", tool_name: null, latency_ms: 900, confidence: 1, payload: { decision: "accept", reason_code: "ALL_CLEAR", all_green: true, spoken_reason: "Good news — we can take this referral. A coordinator will call the patient within the hour." } },
  ];

  const draftB = {
    patient_first_initial: "R",
    patient_age: 66,
    diagnosis_summary: "post-op knee rehab",
    discipline_needed: "PT",
    payer_raw: "UnitedHealthcare Medicare Advantage",
    zip: "07090",
    requested_start: "Monday",
  };
  const evB = [
    { seq: 1, stage: "GREETING", sub_agent: "system", tool_name: null, latency_ms: null, confidence: null, payload: { event: "greeting_sent" } },
    { seq: 2, stage: "COLLECTING", sub_agent: "extractor", tool_name: null, latency_ms: 1500, confidence: 0.98, payload: { updated_fields: Object.keys(draftB), draft: draftB } },
    { seq: 3, stage: "READBACK", sub_agent: "responder", tool_name: null, latency_ms: null, confidence: null, payload: { kind: "readback" } },
    { seq: 4, stage: "DECIDING", sub_agent: "fitchecker", tool_name: "serviceArea", latency_ms: 75, confidence: null, payload: { result: { covered: true, county: "Union" } } },
    { seq: 5, stage: "DECIDING", sub_agent: "fitchecker", tool_name: "payer", latency_ms: 130, confidence: null, payload: { result: { accepted: false, matchedName: "UnitedHealthcare Medicare Advantage" } } },
    { seq: 6, stage: "DECIDING", sub_agent: "fitchecker", tool_name: "capacity", latency_ms: 105, confidence: null, payload: { result: { available: true, openSlots: 3 } } },
    { seq: 7, stage: "DECIDING", sub_agent: "decider", tool_name: null, latency_ms: 850, confidence: 0.98, payload: { decision: "escalate", reason_code: "PAYER_NOT_ACCEPTED", all_green: false, spoken_reason: "I want to make sure we handle the insurance correctly, so I'll have our coordinator confirm and call you right back. What's the best callback number?" } },
    { seq: 8, stage: "CLOSING", sub_agent: "system", tool_name: null, latency_ms: null, confidence: null, payload: { event: "escalation_closed", callback_captured: true } },
  ];

  const rows = [
    ...evA.map((e) => ({ ...e, run_id: runA.run_id, payload: redactPayload(e.payload) })),
    ...evB.map((e) => ({ ...e, run_id: runB.run_id, payload: redactPayload(e.payload) })),
  ];
  await db.from("run_events").insert(rows);

  console.log("seeded demo state:");
  console.log("  ACCEPTED  · M·78 · RN · Medicare · 07081 · ALL_CLEAR");
  console.log(
    "  ESCALATED · R·66 · PT · UnitedHealthcare MA · 07090 · PAYER_NOT_ACCEPTED · callback 2015550199"
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("reset-demo failed:", err);
  process.exit(1);
});
