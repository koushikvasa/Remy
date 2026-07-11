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
// Escalations reassure that a coordinator will call back at THIS number — Remy
// never asks for a callback number (it uses the caller's own line).
const STATIC_SPOKEN: Record<ReasonCode, string> = {
  ALL_CLEAR:
    "Wonderful — we're taking this one, and our coordinator will call the patient within the hour.",
  OUT_OF_AREA:
    "That zip's just outside our usual area, so I don't want to promise on the spot — I'm looping in our coordinator, and they'll call you right back at this number within fifteen minutes.",
  PAYER_NOT_ACCEPTED:
    "I want to double-check the insurance before I promise anything, so I'm looping in our coordinator now — they'll call you right back within fifteen minutes.",
  NO_CAPACITY:
    "We're pretty tight on availability for that this week, so I'm getting our coordinator to confirm timing — they'll call you right back shortly.",
  MISSING_FIELDS:
    "I want to make sure we've got everything right, so our coordinator will follow up with you directly in just a few minutes.",
  LOW_CONFIDENCE:
    "I don't want to guess on this one, so I'm looping in our coordinator — they'll call you right back within fifteen minutes.",
  CALLER_REQUESTED_HUMAN:
    "Of course — I'm getting one of our coordinators to call you right back at this number in just a few minutes.",
  MODEL_ERROR:
    "Let me bring one of our coordinators in so nothing gets lost — they'll call you right back shortly.",
};

const DISCIPLINE_WORDS: Record<string, string> = {
  RN: "skilled nursing",
  PT: "physical therapy",
  OT: "occupational therapy",
  ST: "speech therapy",
  HHA: "home health aide",
  MSW: "medical social work",
};

const WORDING_SYSTEM = `You are Remy, a warm, unhurried home-health intake coordinator who's done this for years. You sound like a real person on the phone, not a form.
The decision is ALREADY made by a deterministic gate — you ONLY word what Remy says out loud. Never change it or imply a different outcome.
Use contractions. Keep it to 1–2 short, natural sentences. No quotes, no lists.
- ACCEPT: sound genuinely pleased. Confirm we're taking the referral and that a coordinator will call the patient within the hour.
- ESCALATE: reassuring, never bureaucratic. Say you don't want to guess and you're looping in a coordinator who will call them right back at this number shortly. Do NOT ask for a callback number, and do NOT promise acceptance.
Refer to the patient by initial and age only — never a full name, and never a gendered pronoun you don't know (use "them" or "the patient").`;

/**
 * A router-level escalation (caller asked for a human, repeated unparseable
 * turns, etc.). This is NOT the fit gate — it only ever escalates, never
 * accepts, so hard rule 1 (an accept requires decide()) is preserved.
 */
export function staticEscalation(reasonCode: ReasonCode): Decision {
  return Decision.parse({
    decision: "escalate",
    reason_code: reasonCode,
    spoken_reason: STATIC_SPOKEN[reasonCode],
  });
}

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
