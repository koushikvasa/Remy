import { ReferralDraft } from "@remy/shared";
import { callModel } from "../model";

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

// ── Conversational responder (P7.2) ────────────────────────────────────────
// One LLM call per non-fast-path turn: reacts to what the caller actually said
// AND (when collecting) works the next missing field in. It NEVER decides,
// accepts, or promises — enforced below by an acceptance guard (rule 1). On any
// failure it returns the deterministic `fallback`, so the caller always hears
// something (rule 5) and the critical path degrades to templates.

const FIELD_LABELS: Record<keyof ReferralDraft, string> = {
  patient_first_initial: "the patient's first initial",
  patient_age: "the patient's age",
  diagnosis_summary: "the main diagnosis",
  discipline_needed: "the discipline needed (nursing, PT, OT, speech, aide, or social work)",
  payer_raw: "the insurance",
  zip: "the ZIP code",
  requested_start: "the requested start date",
};

// Referral-acceptance phrasing the responder must never invent (the gate owns
// this). Deliberately targets accepting the REFERRAL/CASE — not payer coverage
// ("we accept Humana") or service-area coverage ("we cover that ZIP").
const ACCEPTANCE_RE =
  /\b(we'?re taking (this|it|the (referral|case)|them|her|him)|we'?ll take (this|it|the (referral|case|one)|them|her|him)|we can take (this|it|the (referral|case)|them|her|him)|we accept (this|it|the (referral|case)|them)|it'?s accepted|you'?re accepted|we'?ve accepted|it'?s approved|approved the referral|consider it done|it'?s a yes|good to go|we'?ve got (them|her|him) covered)\b/i;

const CONVERSE_SYSTEM = `You are Remy, a warm, unhurried home-health intake coordinator on a phone call. You sound like a real person, not a form.
Reply to what the caller just said in ONE or TWO short sentences, with contractions. Acknowledge first, then continue.
Rules you must NEVER break:
- You do NOT decide anything about the referral. Never say we're taking it, we accept it, it's approved, or make promises about acceptance. If the caller asks whether you'll take it, say you're still getting the details and a coordinator handles the final call.
- If we're still COLLECTING, naturally ask for the ONE next field you're given — nothing else, and don't re-ask fields already known.
- If a FACT is provided (a coverage or next-steps answer), weave it in accurately; never invent facts or numbers.
- If asked whether you're a real person or an AI, be honest and warm: you're Remy, Sunrise's virtual coordinator.
- Refer to the patient by initial and age only — never a name, never a guessed pronoun (use "them"/"the patient").
Keep it to 1-2 short sentences, natural for speech.`;

function summarizeDraft(draft: ReferralDraft): string {
  const bits: string[] = [];
  if (draft.patient_age !== null) bits.push(`${draft.patient_age}yo`);
  if (draft.patient_first_initial) bits.push(`initial ${draft.patient_first_initial}`);
  if (draft.diagnosis_summary) bits.push(draft.diagnosis_summary);
  if (draft.discipline_needed) bits.push(disciplineWord(draft.discipline_needed));
  if (draft.payer_raw) bits.push(draft.payer_raw);
  if (draft.zip) bits.push(`ZIP ${draft.zip}`);
  if (draft.requested_start) bits.push(`start ${draft.requested_start}`);
  return bits.length ? bits.join(", ") : "nothing yet";
}

export interface ConverseOpts {
  mode: "collecting" | "closing";
  draft: ReferralDraft;
  nextField: keyof ReferralDraft | null;
  userText: string;
  history: { role: "user" | "assistant"; content: string }[];
  toolAnswer?: string | null;
  decisionKind?: "accept" | "escalate" | "decline" | null;
  referenceCode?: string | null;
  allowAcceptance: boolean;
  fallback: string;
}

function collectingPrompt(o: ConverseOpts): string {
  const field = o.nextField ? FIELD_LABELS[o.nextField] : "nothing — you have it all";
  const fact = o.toolAnswer ? ` A fact to share accurately: "${o.toolAnswer}".` : "";
  return (
    `We're COLLECTING a referral. Known so far: ${summarizeDraft(o.draft)}. ` +
    `The one field I still need: ${field}.${fact} ` +
    `The caller just said: "${o.userText}". ` +
    `Write Remy's next line — acknowledge what they said${o.toolAnswer ? ", share that fact," : ""} and ask for that one field.`
  );
}

function closingPrompt(o: ConverseOpts): string {
  const promise =
    o.decisionKind === "accept"
      ? "A coordinator will call the patient within the hour."
      : "A coordinator will call back within fifteen minutes.";
  const fact = o.toolAnswer ? ` A fact to share accurately: "${o.toolAnswer}".` : "";
  const ref = o.referenceCode ? ` The reference code is ${o.referenceCode}.` : "";
  return (
    `The referral is already handled (${o.decisionKind ?? "logged"}). ${promise}${ref}${fact} ` +
    `The caller just said: "${o.userText}". ` +
    `Answer them warmly and consistently — do NOT re-decide or change anything. If they're wrapping up, give a brief warm goodbye.`
  );
}

export async function converse(o: ConverseOpts): Promise<string> {
  try {
    const user = o.mode === "collecting" ? collectingPrompt(o) : closingPrompt(o);
    const raw = await callModel({
      system: CONVERSE_SYSTEM,
      messages: [...o.history.slice(-6), { role: "user", content: user }],
      temperature: 0.4,
      maxTokens: 80,
      timeoutMs: 6000,
    });
    const text = raw.trim();
    if (!text) return o.fallback;
    // Rule 1 guard: the responder can never invent acceptance outside an
    // actual accept decision.
    if (!o.allowAcceptance && ACCEPTANCE_RE.test(text)) return o.fallback;
    return text;
  } catch {
    return o.fallback;
  }
}

// ── Deterministic CLOSING templates ─────────────────────────────────────────

export function warmCloseLine(): string {
  return "Thanks so much for calling — we've got it from here. Take care now, bye.";
}

export function nudgeLine(): string {
  return "Take your time — anything else I can grab for you?";
}

export function referenceRepeat(code: string): string {
  return `Sure thing — your reference is ${code}. Anything else?`;
}

export function newReferralPrompt(): string {
  return "Of course — go ahead, I'm ready when you are.";
}

