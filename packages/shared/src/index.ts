import { z } from "zod";

/**
 * Sub-agent I/O contracts for Remy (REMY_SPEC.md §6).
 * These zod schemas ARE the contracts between the router and every sub-agent.
 * All sub-agent I/O is validated against them (CLAUDE.md hard rule 6).
 */

// The six home-health disciplines Remy staffs.
export const Discipline = z.enum(["RN", "PT", "OT", "ST", "HHA", "MSW"]);
export type Discipline = z.infer<typeof Discipline>;

// ReferralDraft — what the Extractor fills, turn by turn.
export const ReferralDraft = z.object({
  patient_first_initial: z.string().max(2).nullable(),
  patient_age: z.number().int().min(0).max(120).nullable(),
  diagnosis_summary: z.string().nullable(), // plain words, no codes needed
  discipline_needed: Discipline.nullable(),
  payer_raw: z.string().nullable(), // exactly what caller said
  zip: z
    .string()
    .regex(/^\d{5}$/)
    .nullable(),
  requested_start: z.string().nullable(), // free text ok ("tomorrow")
});
export type ReferralDraft = z.infer<typeof ReferralDraft>;

// ExtractorOut — the Extractor's per-turn output.
export const ExtractorOut = z.object({
  draft: ReferralDraft, // merged view after this turn
  updated_fields: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  needs_clarification: z.string().nullable(), // question to ask, if any
});
export type ExtractorOut = z.infer<typeof ExtractorOut>;

// FitResult — produced by the FitChecker (pure code, no LLM).
export const FitResult = z.object({
  zip_covered: z.boolean().nullable(), // null = unknown yet
  payer_accepted: z.boolean().nullable(),
  payer_matched_name: z.string().nullable(),
  capacity_available: z.boolean().nullable(),
  open_slots: z.number().nullable(),
  all_green: z.boolean(),
  missing_fields: z.array(z.string()),
});
export type FitResult = z.infer<typeof FitResult>;

// Decision — the deterministic gate's output.
// `decision` and `reason_code` are set by decide() in code, NEVER by the model
// (CLAUDE.md hard rule 1). The model only writes `spoken_reason`.
export const DecisionKind = z.enum(["accept", "escalate", "decline"]);
export type DecisionKind = z.infer<typeof DecisionKind>;

export const ReasonCode = z.enum([
  "ALL_CLEAR",
  "OUT_OF_AREA",
  "PAYER_NOT_ACCEPTED",
  "NO_CAPACITY",
  "MISSING_FIELDS",
  "LOW_CONFIDENCE",
  "CALLER_REQUESTED_HUMAN",
  "MODEL_ERROR",
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const Decision = z.object({
  decision: DecisionKind,
  reason_code: ReasonCode,
  spoken_reason: z.string(), // what Remy says out loud
});
export type Decision = z.infer<typeof Decision>;
