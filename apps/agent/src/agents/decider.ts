import {
  Decision,
  DecisionKind,
  FitResult,
  ReasonCode,
  ReferralDraft,
} from "@remy/shared";
import { callModel } from "../model";

/**
 * decider.ts — THE DECISION GATE (CLAUDE.md hard rule 1, REMY_SPEC.md §7).
 *
 * decide() is the ONLY place a decision is produced. It is pure and deterministic
 * — an accept is impossible unless the database said yes three times. The LLM
 * only WORDS the spoken explanation; it can never set decision or reason_code.
 */

export interface Gate {
  decision: DecisionKind;
  reason_code: ReasonCode;
}

// Exactly as written in §7.
export function decide(
  fit: FitResult,
  _draft: ReferralDraft,
  confidence: number
): Gate {
  if (fit.missing_fields.length > 0) return { decision: "escalate", reason_code: "MISSING_FIELDS" };
  if (confidence < 0.7) return { decision: "escalate", reason_code: "LOW_CONFIDENCE" };
  if (fit.zip_covered === false) return { decision: "escalate", reason_code: "OUT_OF_AREA" };
  if (fit.payer_accepted === false) return { decision: "escalate", reason_code: "PAYER_NOT_ACCEPTED" };
  if (fit.capacity_available === false) return { decision: "escalate", reason_code: "NO_CAPACITY" };
  if (fit.all_green) return { decision: "accept", reason_code: "ALL_CLEAR" };
  return { decision: "escalate", reason_code: "LOW_CONFIDENCE" };
}

// Deterministic fallback wording — used verbatim if the LLM call fails (rule 5).
const STATIC_SPOKEN: Record<ReasonCode, string> = {
  ALL_CLEAR:
    "Good news — we can take this referral. Our coordinator will call the patient within the hour to schedule.",
  OUT_OF_AREA:
    "That ZIP looks to be just outside our service area, so I'll have our coordinator confirm and follow up. What's the best callback number?",
  PAYER_NOT_ACCEPTED:
    "I want to make sure we handle the insurance correctly, so I'll have our coordinator confirm coverage and call right back. What's the best callback number?",
  NO_CAPACITY:
    "We're tight on availability for that discipline this week, so I'll have our coordinator confirm timing and follow up. What's the best callback number?",
  MISSING_FIELDS:
    "I want to be sure I have everything, so I'll have our coordinator follow up to complete the details. What's the best callback number?",
  LOW_CONFIDENCE:
    "I want to be certain I've got this exactly right, so I'll have our coordinator confirm and call you back. What's the best callback number?",
  CALLER_REQUESTED_HUMAN:
    "Of course — I'll get our intake coordinator to call you right back. What's the best callback number?",
  MODEL_ERROR:
    "Let me connect you with our intake coordinator to make sure nothing is lost.",
};

const DISCIPLINE_WORDS: Record<string, string> = {
  RN: "skilled nursing",
  PT: "physical therapy",
  OT: "occupational therapy",
  ST: "speech therapy",
  HHA: "home health aide",
  MSW: "medical social work",
};

const WORDING_SYSTEM = `You are Remy, a warm, efficient voice agent on a home-health referral phone call.
The decision has ALREADY been made by a deterministic gate. You do NOT decide anything — you only word what Remy says out loud.
Return ONE or TWO short spoken sentences, plain text (no quotes, no lists).
- If the decision is ACCEPT: warmly confirm we're taking the referral and that a coordinator will call the patient within the hour.
- If the decision is ESCALATE: do NOT fake a yes and do NOT promise acceptance. Briefly acknowledge, say a coordinator will follow up, and ASK for the best callback number.
Never state a patient's full name — reference only initial and age. Keep it natural for speech.`;

function contextLine(gate: Gate, draft: ReferralDraft, fit: FitResult): string {
  const discipline = draft.discipline_needed
    ? DISCIPLINE_WORDS[draft.discipline_needed] ?? draft.discipline_needed
    : "care";
  return [
    `decision=${gate.decision}`,
    `reason_code=${gate.reason_code}`,
    `patient=${draft.patient_age ?? "?"}yo initial ${draft.patient_first_initial ?? "?"}`,
    `discipline=${discipline}`,
    `payer=${draft.payer_raw ?? "?"}${fit.payer_matched_name ? ` (matched ${fit.payer_matched_name})` : ""}`,
    `zip=${draft.zip ?? "?"} covered=${fit.zip_covered}`,
    `payer_accepted=${fit.payer_accepted}`,
    `capacity_available=${fit.capacity_available}`,
  ].join(", ");
}

/**
 * Word the spoken_reason for an already-made decision. Never throws: on any model
 * failure it returns the static line so the caller always hears something.
 */
export async function wordDecision(
  gate: Gate,
  draft: ReferralDraft,
  fit: FitResult
): Promise<Decision> {
  let spoken = STATIC_SPOKEN[gate.reason_code];

  try {
    const text = await callModel({
      system: WORDING_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Context: ${contextLine(gate, draft, fit)}\nWrite Remy's spoken line.`,
        },
      ],
    });
    const trimmed = text.trim();
    if (trimmed) spoken = trimmed;
  } catch {
    // keep the static fallback — no dead air
  }

  return Decision.parse({
    decision: gate.decision,
    reason_code: gate.reason_code,
    spoken_reason: spoken,
  });
}
