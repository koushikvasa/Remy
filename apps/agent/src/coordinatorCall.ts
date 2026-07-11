import { escapeXml } from "./twiml";
import { logEvent } from "./telemetry";
import {
  assignReferral,
  getActiveCoordinator,
  getEscalatedReferral,
  referralShortCode,
  type EscalatedReferral,
} from "./coordinators";

/**
 * Outbound-callout TwiML (P6). Pure/deterministic — NO LLM anywhere on this
 * path (rule 1 spirit + latency). The spoken brief is PHI-safe: initial + age
 * only, plus a reason phrase from a STATIC map of reason_code.
 */

const DISCIPLINE_WORDS: Record<string, string> = {
  RN: "skilled nursing",
  PT: "physical therapy",
  OT: "occupational therapy",
  ST: "speech therapy",
  HHA: "a home health aide",
  MSW: "medical social work",
};

const REASON_PHRASE: Record<string, string> = {
  OUT_OF_AREA: "the patient's ZIP is outside our usual service area",
  PAYER_NOT_ACCEPTED: "we're not in network with the patient's insurance",
  NO_CAPACITY: "we're at capacity for that discipline this week",
  MISSING_FIELDS: "some referral details still need confirming",
  LOW_CONFIDENCE: "the details need a person to confirm",
  CALLER_REQUESTED_HUMAN: "the caller asked to speak with a coordinator",
  MODEL_ERROR: "the system needs a person to take over",
};

function xml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`;
}

function unavailable(): string {
  return xml(`<Say>That referral is no longer available. Goodbye.</Say><Hangup/>`);
}

function brief(r: EscalatedReferral): string {
  const discipline = DISCIPLINE_WORDS[r.discipline_needed ?? ""] ?? "home health";
  const zip = (r.zip ?? "").split("").join(" "); // read digits individually
  const reason = REASON_PHRASE[r.reason_code ?? ""] ?? "it needs a person to review";
  return (
    `Sunrise Home Health has an escalated referral for you. ` +
    `A ${r.patient_age ?? "unknown age"} year old patient, initial ${r.patient_first_initial ?? "unknown"}, ` +
    `needs ${discipline}. Insurance is ${r.payer_raw ?? "unspecified"}. Zip code ${zip}. ` +
    `It escalated because ${reason}.`
  );
}

/** TwiML fetched when the coordinator answers: brief + gather one digit. */
export async function coordinatorCallTwiml(referralId: string): Promise<string> {
  const r = await getEscalatedReferral(referralId);
  if (!r || r.decision !== "escalated") return unavailable();

  const action = `/coordinator-choice?referral_id=${encodeURIComponent(referralId)}`;
  return xml(
    `<Say>${escapeXml(brief(r))}</Say>` +
      `<Gather numDigits="1" action="${escapeXml(action)}" method="POST" timeout="8" input="dtmf">` +
      `<Say>Press 1 to take this case. Press 2 to pass.</Say>` +
      `</Gather>` +
      `<Say>We didn't catch that. No problem — we'll follow up another way. Goodbye.</Say><Hangup/>`
  );
}

/** TwiML after the coordinator presses a digit (or times out). */
export async function coordinatorChoiceTwiml(
  referralId: string,
  digits: string
): Promise<string> {
  const r = await getEscalatedReferral(referralId);
  if (!r || r.decision !== "escalated") return unavailable();

  if (digits === "1" && r.assigned_to) {
    return xml(`<Say>That referral is already assigned. Goodbye.</Say><Hangup/>`);
  }

  if (digits === "1") {
    const coord = await getActiveCoordinator();
    const ok = coord ? await assignReferral(r.id, coord.id) : false;
    if (ok && r.run_id) {
      await logEvent({
        runId: r.run_id,
        stage: "CLOSING",
        subAgent: "system",
        toolName: "callout",
        payload: { event: "assigned", code: referralShortCode(r.id), coordinator: coord?.name },
      });
    }
    return ok
      ? xml(`<Say>Assigned to you. The referral card is on your dashboard. Goodbye.</Say><Hangup/>`)
      : xml(`<Say>Sorry, we couldn't assign that right now. Goodbye.</Say><Hangup/>`);
  }

  // Digit 2, anything else, or no input (timeout falls through here) → stays escalated.
  if (r.run_id) {
    await logEvent({
      runId: r.run_id,
      stage: "CLOSING",
      subAgent: "system",
      toolName: "callout",
      payload: { event: "passed", code: referralShortCode(r.id) },
    });
  }
  return xml(
    `<Say>No problem. We'll keep it in the queue for another coordinator. Goodbye.</Say><Hangup/>`
  );
}
