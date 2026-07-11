import { escapeXml } from "./twiml";
import { logEvent } from "./telemetry";
import { notifySourceOfAssignment } from "./escalation";
import {
  assignReferral,
  getActiveCoordinator,
  getCoordinatorById,
  getEscalatedReferral,
  referralShortCode,
  type EscalatedReferral,
} from "./coordinators";

/**
 * Outbound-callout TwiML (P6/P7). Pure/deterministic — NO LLM on this path.
 * The spoken brief is PHI-safe (initial + age only) and Remy stays in persona:
 * warm, human, polite endings. <Say> uses a warm neural voice (REMY_SAY_VOICE,
 * default Polly.Joanna-Neural) since <Say> can't use ElevenLabs.
 */

const SAY_VOICE = process.env.REMY_SAY_VOICE || "Polly.Joanna-Neural";

const DISCIPLINE_WORDS: Record<string, string> = {
  RN: "skilled nursing",
  PT: "physical therapy",
  OT: "occupational therapy",
  ST: "speech therapy",
  HHA: "a home health aide",
  MSW: "medical social work",
};

// Warm, human snippet explaining why it couldn't clear automatically.
const REASON_SNIPPET: Record<string, string> = {
  OUT_OF_AREA: "the zip's just outside our usual area",
  PAYER_NOT_ACCEPTED: "that's the snag — we're not contracted with them",
  NO_CAPACITY: "we're tight on availability for that this week",
  MISSING_FIELDS: "a couple details still need confirming",
  LOW_CONFIDENCE: "I'd just feel better with a person on it",
  CALLER_REQUESTED_HUMAN: "the caller asked for a person",
  MODEL_ERROR: "the system needs a person to take over",
};

function say(text: string): string {
  return `<Say voice="${escapeXml(SAY_VOICE)}">${escapeXml(text)}</Say>`;
}

function xml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`;
}

function unavailable(): string {
  return xml(say("That one's already been handled — thanks so much. Bye now.") + "<Hangup/>");
}

// A referral is callable to a coordinator whether we accepted it (confirm the
// case) or escalated it (ask a person to take it).
function callable(decision: string | null): boolean {
  return decision === "accepted" || decision === "escalated";
}

function brief(r: EscalatedReferral): string {
  const discipline = DISCIPLINE_WORDS[r.discipline_needed ?? ""] ?? "home health";
  const payer = r.payer_raw ?? "an unspecified plan";
  const age = r.patient_age ?? "new";

  if (r.decision === "accepted") {
    return (
      `Hi, it's Remy from Sunrise Home Health — good news. I've just accepted a new referral: ` +
      `a ${age}-year-old needing ${discipline}, on ${payer}. Can you take the case?`
    );
  }

  const snippet = REASON_SNIPPET[r.reason_code ?? ""] ?? "I'd just like a person to look";
  return (
    `Hi, it's Remy from Sunrise Home Health — sorry to interrupt. ` +
    `I've got a referral I couldn't clear automatically: a ${age}-year-old ` +
    `needing ${discipline}, on ${payer} — ${snippet}.`
  );
}

/** TwiML fetched when the coordinator answers: warm brief + gather one digit. */
export async function coordinatorCallTwiml(referralId: string): Promise<string> {
  const r = await getEscalatedReferral(referralId);
  if (!r || !callable(r.decision)) return unavailable();

  const action = `/coordinator-choice?referral_id=${encodeURIComponent(referralId)}`;
  return xml(
    say(brief(r)) +
      `<Gather numDigits="1" action="${escapeXml(action)}" method="POST" timeout="8" input="dtmf">` +
      say("Press 1 if you can take it, or 2 to pass.") +
      `</Gather>` +
      say("No worries — I'll follow up another way. Take care.") +
      "<Hangup/>"
  );
}

/** TwiML after the coordinator presses a digit (or times out). */
export async function coordinatorChoiceTwiml(
  referralId: string,
  digits: string
): Promise<string> {
  const r = await getEscalatedReferral(referralId);
  if (!r || !callable(r.decision)) return unavailable();

  if (digits === "1" && r.assigned_to) {
    return xml(say("Looks like that one's already been picked up — thanks, and take care.") + "<Hangup/>");
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
    if (ok) {
      // Third leg: call the referral source back with the update.
      await notifySourceOfAssignment({ runId: r.run_id, referralId: r.id });
      return xml(
        say("Wonderful — it's all yours. The referral card's on your dashboard now. Thanks so much — bye now.") +
          "<Hangup/>"
      );
    }
    return xml(say("Hmm, I couldn't lock that in just now — I'll follow up. Thanks, bye now.") + "<Hangup/>");
  }

  // Digit 2, anything else, or no input (timeout falls through here).
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
    say("No problem at all — I'll keep it in the queue for someone else. Thanks so much, take care.") +
      "<Hangup/>"
  );
}

/** TwiML for the source call-back: <Say> only (no gather). Voicemail-safe. */
export async function sourceNotifyTwiml(referralId: string): Promise<string> {
  const r = await getEscalatedReferral(referralId);
  if (!r) {
    return xml(say("Thanks for calling Sunrise Home Health. Take care.") + "<Hangup/>");
  }
  const coord = await getCoordinatorById(r.assigned_to);
  const who = coord?.name ? `coordinator ${coord.name}` : "one of our coordinators";
  const initial = r.patient_first_initial ?? "your patient";
  const code = referralShortCode(r.id);
  const text =
    `Hi, this is Remy from Sunrise Home Health with some good news about your referral for patient ${initial} — ` +
    `${who} has picked it up and will call you within fifteen minutes. ` +
    `Your reference is ${code}. Thanks again for sending this our way. Take care.`;
  return xml(say(text) + "<Hangup/>");
}
