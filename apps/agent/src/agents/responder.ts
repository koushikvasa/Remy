import { ReferralDraft } from "@remy/shared";

/**
 * Responder sub-agent (REMY_SPEC.md §7). Turns router intent into a SHORT spoken
 * line — this is a phone call, so 1-2 sentences (CLAUDE.md conventions).
 *
 * Deterministic in P2 for reliability and latency: the Extractor already produces
 * natural clarification questions, and readback is templated. (The LLM-worded
 * spoken_reason for a decision comes later, in P3's decider.)
 */

export const ESCALATION_LINE =
  "Let me connect you with our intake coordinator to make sure nothing is lost.";

const FIELD_QUESTIONS: Record<keyof ReferralDraft, string> = {
  patient_first_initial: "What's the patient's first initial?",
  patient_age: "And how old is the patient?",
  diagnosis_summary: "What's the main diagnosis or reason for home health?",
  discipline_needed:
    "Which discipline do they need — nursing, physical therapy, occupational therapy, speech, a home health aide, or medical social work?",
  payer_raw: "What insurance does the patient have?",
  zip: "What's the patient's five-digit ZIP code?",
  requested_start: "When would you like care to start?",
};

const DISCIPLINE_WORDS: Record<string, string> = {
  RN: "skilled nursing",
  PT: "physical therapy",
  OT: "occupational therapy",
  ST: "speech therapy",
  HHA: "a home health aide",
  MSW: "medical social work",
};

/** Ask the Extractor's clarification question. */
export function askClarification(question: string): string {
  return question.trim();
}

/** Fallback: ask for the first still-missing field. */
export function askForField(field: keyof ReferralDraft): string {
  return FIELD_QUESTIONS[field];
}

/** Gentler re-ask after a turn we couldn't parse. */
export function politeReprompt(field: keyof ReferralDraft): string {
  return `Sorry, I didn't quite catch that. ${FIELD_QUESTIONS[field]}`;
}

/** "No problem — what should I fix?" after a failed readback. */
export function correctionPrompt(): string {
  return "No problem — what should I correct?";
}

/** Re-prompt when a readback yes/no was ambiguous. */
export function confirmPrompt(): string {
  return "Sorry — did I get that right? A quick yes or no is perfect.";
}

/** Read the structured referral back for confirmation. */
export function readback(draft: ReferralDraft): string {
  const discipline = draft.discipline_needed
    ? DISCIPLINE_WORDS[draft.discipline_needed] ?? draft.discipline_needed
    : "care";

  const parts: string[] = [];
  if (draft.patient_age !== null) parts.push(`a ${draft.patient_age}-year-old patient`);
  else parts.push("the patient");
  if (draft.patient_first_initial) parts.push(`initial ${draft.patient_first_initial}`);
  if (draft.diagnosis_summary) parts.push(`with ${draft.diagnosis_summary}`);
  parts.push(`needing ${discipline}`);
  if (draft.payer_raw) parts.push(`insured by ${draft.payer_raw}`);
  if (draft.zip) parts.push(`in ZIP ${draft.zip}`);
  if (draft.requested_start) parts.push(`starting ${draft.requested_start}`);

  return `Let me read that back: ${parts.join(", ")}. Did I get that right?`;
}
