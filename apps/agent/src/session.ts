import { Decision, FitResult, ReferralDraft } from "@remy/shared";
import { createRun, logEvent } from "./telemetry";

/**
 * session.ts — per-call state (REMY_SPEC.md §7). One Session per phone call (or
 * per simulator run). The router advances `stage` and fills `draft`.
 */

export type Stage =
  | "GREETING"
  | "COLLECTING"
  | "READBACK"
  | "DECIDING"
  | "CLOSING";

export interface Session {
  runId: string;
  callerPhone: string;
  sourceId: string | null;
  stage: Stage;
  draft: ReferralDraft;
  messages: { role: "user" | "assistant"; content: string }[];
  lastConfidence: number;
  finalized: boolean;
  // DECIDING / CLOSING state (P3)
  fit: FitResult | null;
  decision: Decision | null;
  payerMatchedId: string | null;
  awaitingCallback: boolean;
  callbackPhone: string | null;
  // robustness (P5): consecutive turns that yielded no new field
  unparseableStreak: number;
}

// GREETING is delivered via TwiML welcomeGreeting on a real call; the simulator
// prints it. Unknown-caller wording (caller lookup / personalization is P5).
export const GREETING =
  "Thanks for calling Sunrise Home Health — this is Remy! Who am I speaking with, and what've you got for me?";

export function emptyDraft(): ReferralDraft {
  return {
    patient_first_initial: null,
    patient_age: null,
    diagnosis_summary: null,
    discipline_needed: null,
    payer_raw: null,
    zip: null,
    requested_start: null,
  };
}

export interface StartSessionInput {
  callerPhone: string;
  sourceId?: string | null;
}

export async function startSession(input: StartSessionInput): Promise<Session> {
  const runId = await createRun({
    callerPhone: input.callerPhone,
    sourceId: input.sourceId ?? null,
  });

  await logEvent({
    runId,
    stage: "GREETING",
    subAgent: "system",
    payload: { event: "greeting_sent" },
  });

  return {
    runId,
    callerPhone: input.callerPhone,
    sourceId: input.sourceId ?? null,
    stage: "GREETING",
    draft: emptyDraft(),
    messages: [{ role: "assistant", content: GREETING }],
    lastConfidence: 0,
    finalized: false,
    fit: null,
    decision: null,
    payerMatchedId: null,
    awaitingCallback: false,
    callbackPhone: null,
    unparseableStreak: 0,
  };
}
