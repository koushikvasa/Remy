import { ExtractorOut, ReferralDraft } from "@remy/shared";
import { callModel } from "../model";

/**
 * Extractor sub-agent (REMY_SPEC.md §7). Given the conversation so far and the
 * current draft, returns an ExtractorOut with the merged draft.
 *
 * Contract-bound (CLAUDE.md hard rule 6): the model output is zod-validated
 * against packages/shared. On validation failure → one retry with the error
 * appended → then throw ModelError so the router escalates(MODEL_ERROR).
 */

export type Msg = { role: "user" | "assistant"; content: string };

export class ModelError extends Error {
  readonly reasonCode = "MODEL_ERROR" as const;
}

export const DRAFT_FIELDS = [
  "patient_first_initial",
  "patient_age",
  "diagnosis_summary",
  "discipline_needed",
  "payer_raw",
  "zip",
  "requested_start",
] as const;

// OpenAI structured-output schema. Kept strict-mode-safe: every property is
// required, additionalProperties:false, nullables via ["type","null"], and NO
// pattern/min/max/enum constraints (those are enforced afterwards by zod).
const EXTRACTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    draft: {
      type: "object",
      additionalProperties: false,
      properties: {
        patient_first_initial: { type: ["string", "null"] },
        patient_age: { type: ["integer", "null"] },
        diagnosis_summary: { type: ["string", "null"] },
        discipline_needed: { type: ["string", "null"] },
        payer_raw: { type: ["string", "null"] },
        zip: { type: ["string", "null"] },
        requested_start: { type: ["string", "null"] },
      },
      required: [
        "patient_first_initial",
        "patient_age",
        "diagnosis_summary",
        "discipline_needed",
        "payer_raw",
        "zip",
        "requested_start",
      ],
    },
    updated_fields: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    needs_clarification: { type: ["string", "null"] },
  },
  required: ["draft", "updated_fields", "confidence", "needs_clarification"],
} as const;

const SYSTEM = `You are the Extractor for Remy, a voice agent taking a home-health referral over the phone.
From the conversation, fill a structured referral. Return ONLY JSON matching the required schema.

Fields:
- patient_first_initial: the patient's first initial only (a single letter). Never a full name.
- patient_age: integer years.
- diagnosis_summary: short plain-language reason for home health (e.g. "CHF exacerbation"). No codes needed.
- discipline_needed: map the caller's words to ONE code:
    RN = skilled nursing / nurse; PT = physical therapy; OT = occupational therapy;
    ST = speech therapy / speech-language; HHA = home health aide; MSW = medical social work.
- payer_raw: the insurance EXACTLY as the caller said it (do not normalize).
- zip: the patient's 5-digit ZIP code.
- requested_start: when care should start, free text is fine ("tomorrow", "Monday").

Rules:
- Use null for anything not yet stated. Never invent values.
- Carry forward everything already known; return the full merged draft each turn.
- confidence: 0-1, your certainty in the fields you set this turn.
- needs_clarification: a SHORT question to ask the caller if something essential is ambiguous;
  otherwise null. Do not ask about fields already filled.`;

function mergeDraft(prev: ReferralDraft, next: ReferralDraft): ReferralDraft {
  const out: ReferralDraft = { ...prev };
  for (const f of DRAFT_FIELDS) {
    const v = next[f];
    if (v !== null && v !== undefined) {
      // never overwrite a known value with null; accept new/corrected values
      (out[f] as unknown) = v;
    }
  }
  return out;
}

function changedFields(prev: ReferralDraft, merged: ReferralDraft): string[] {
  return DRAFT_FIELDS.filter(
    (f) => JSON.stringify(prev[f]) !== JSON.stringify(merged[f])
  );
}

export async function extract(
  prev: ReferralDraft,
  conversation: Msg[]
): Promise<ExtractorOut> {
  const baseMessages: Msg[] = [
    ...conversation,
    {
      role: "user",
      content: `Current draft so far (JSON): ${JSON.stringify(
        prev
      )}\nUpdate it from the conversation above and return the full ExtractorOut JSON.`,
    },
  ];

  let messages = baseMessages;

  // Two attempts total = one retry (CLAUDE.md hard rule 6).
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await callModel({
        system: SYSTEM,
        messages,
        jsonSchema: EXTRACTOR_SCHEMA,
      });
    } catch (err) {
      // timeout / provider error → escalate immediately (no dead air, rule 5)
      throw new ModelError(`callModel failed: ${(err as Error).message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      messages = [
        ...baseMessages,
        { role: "user", content: "Your last response was not valid JSON. Return only the JSON object." },
      ];
      continue;
    }

    const result = ExtractorOut.safeParse(parsed);
    if (result.success) {
      const merged = mergeDraft(prev, result.data.draft);
      return {
        draft: merged,
        updated_fields: changedFields(prev, merged),
        confidence: result.data.confidence,
        needs_clarification: result.data.needs_clarification,
      };
    }

    messages = [
      ...baseMessages,
      {
        role: "user",
        content: `Your last output failed validation: ${result.error.message}. Fix it and return only valid JSON.`,
      },
    ];
  }

  throw new ModelError("Extractor output failed validation after one retry");
}
