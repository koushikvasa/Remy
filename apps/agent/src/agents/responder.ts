import { ReferralDraft } from "@remy/shared";

/**
 * Responder (REMY_SPEC.md §7) — Remy's voice. She's a warm, unhurried intake
 * coordinator who's done this for years: contractions, short sentences, an
 * acknowledgment before the next ask, the occasional empathy beat. Still
 * deterministic (no LLM, low latency), still ONE missing field per turn.
 *
 * Gender-neutral on purpose: the draft carries no patient gender, so Remy says
 * "them" / "the patient" rather than guessing "he" or "she".
 */

export const ESCALATION_LINE =
  "Let me bring one of our coordinators in on this so nothing slips through — one moment.";

const DISCIPLINE_WORDS: Record<string, string> = {
  RN: "skilled nursing",
  PT: "physical therapy",
  OT: "occupational therapy",
  ST: "speech therapy",
  HHA: "a home health aide",
  MSW: "medical social work",
};

// Conversational asks — one field each, phrased like a person, not a form.
const FIELD_QUESTIONS: Record<keyof ReferralDraft, string> = {
  patient_first_initial: "who've you got for me — just the patient's first initial is perfect?",
  patient_age: "and how old are they?",
  diagnosis_summary: "what's going on with them — the main diagnosis?",
  discipline_needed:
    "what kind of care do they need — nursing, physical or occupational therapy, speech, an aide, or social work?",
  payer_raw: "and what insurance are they on?",
  zip: "what's the best zip code for where they'll be staying?",
  requested_start: "and when are we hoping to start?",
};

const DIGIT_WORDS: Record<string, string> = {
  "0": "oh",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
};

/** Speak a zip digit-by-digit: "07081" → "oh seven oh eight one". */
function spellZip(zip: string): string {
  return zip
    .split("")
    .map((d) => DIGIT_WORDS[d] ?? d)
    .join(" ");
}

function disciplineWord(code: string | null): string {
  if (!code) return "care";
  return DISCIPLINE_WORDS[code] ?? code;
}

/** "a" vs "an" for a spoken age (8, 11, 18, 80–89 start with a vowel sound). */
function article(age: number | null): string {
  if (age === null) return "a";
  return age === 8 || age === 11 || age === 18 || (age >= 80 && age <= 89) ? "an" : "a";
}

/** A brief acknowledgment of the most salient field captured this turn. */
function acknowledgment(draft: ReferralDraft, updated: string[]): string {
  if (!updated || updated.length === 0) return "";
  const priority: (keyof ReferralDraft)[] = [
    "diagnosis_summary",
    "discipline_needed",
    "payer_raw",
    "patient_age",
    "zip",
    "requested_start",
    "patient_first_initial",
  ];
  const field = priority.find((f) => updated.includes(f));
  switch (field) {
    case "diagnosis_summary":
      return `${draft.diagnosis_summary}, got it —`;
    case "discipline_needed":
      return `${disciplineWord(draft.discipline_needed)}, sure —`;
    case "payer_raw":
      return `${draft.payer_raw}, perfect —`;
    case "patient_age":
      // empathy beat for older patients (fires once, when age is captured)
      return (draft.patient_age ?? 0) >= 80
        ? "we'll take good care of them —"
        : "okay —";
    case "zip":
      return "got it —";
    case "requested_start":
      return "sounds good —";
    case "patient_first_initial":
      return "okay —";
    default:
      return "";
  }
}

/** Ask for one field, warmly, with an acknowledgment of what was just captured. */
export function nextQuestion(
  draft: ReferralDraft,
  updated: string[],
  field: keyof ReferralDraft
): string {
  const ack = acknowledgment(draft, updated);
  const q = FIELD_QUESTIONS[field];
  return ack ? `${ack} ${q}` : q;
}

/** Ask for one field with no acknowledgment (fillers, off-script resumes). */
export function askForField(field: keyof ReferralDraft): string {
  return FIELD_QUESTIONS[field];
}

/** Gentler re-ask after a turn we couldn't parse. */
export function politeReprompt(field: keyof ReferralDraft): string {
  return `Sorry, I didn't quite catch that — ${FIELD_QUESTIONS[field]}`;
}

export function correctionPrompt(): string {
  return "Oh, no problem — what should I fix?";
}

export function confirmPrompt(): string {
  return "Sorry — was that a yes? I just want to be sure I've got it right.";
}

/** Natural readback, not a field list. */
export function readback(draft: ReferralDraft): string {
  const parts: string[] = [];
  parts.push(
    draft.patient_age !== null
      ? `${article(draft.patient_age)} ${draft.patient_age}-year-old patient`
      : "the patient"
  );
  if (draft.patient_first_initial) parts.push(`initial ${draft.patient_first_initial}`);
  if (draft.diagnosis_summary) parts.push(`with ${draft.diagnosis_summary}`);
  parts.push(`needs ${disciplineWord(draft.discipline_needed)}`);
  if (draft.payer_raw) parts.push(`on ${draft.payer_raw}`);
  if (draft.zip) parts.push(`in ${spellZip(draft.zip)}`);
  if (draft.requested_start) parts.push(`hoping to start ${draft.requested_start}`);

  return `Let me make sure I've got this — ${parts.join(", ")}. Did I get all that right?`;
}
