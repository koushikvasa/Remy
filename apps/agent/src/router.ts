import { ReferralDraft } from "@remy/shared";
import { Session } from "./session";
import { extract, DRAFT_FIELDS, ModelError } from "./agents/extractor";
import {
  askClarification,
  askForField,
  confirmPrompt,
  correctionPrompt,
  readback,
  ESCALATION_LINE,
} from "./agents/responder";
import { logEvent, finalizeRun } from "./telemetry";

/**
 * router.ts — the per-call stage machine (REMY_SPEC.md §7).
 *
 * P2 implements GREETING → COLLECTING → READBACK. On a confirmed readback the
 * stage advances to DECIDING, which P3 (fitchecker + decider gate) will own; for
 * now the run is marked completed after a successful readback.
 *
 * Every turn is wrapped so a model failure never leaves dead air (rule 5): the
 * caller hears the static escalation line and the run is marked failed.
 */

export interface TurnResult {
  reply: string;
  done: boolean; // conversation over (completed or escalated)
  escalated?: boolean;
}

function missingFields(draft: ReferralDraft): (keyof ReferralDraft)[] {
  return DRAFT_FIELDS.filter((f) => draft[f] === null || draft[f] === undefined);
}

const AFFIRMATIVE =
  /\b(yes|yeah|yep|yup|correct|right|that'?s right|looks good|sounds good|perfect|exactly|all good)\b/i;
const NEGATIVE =
  /\b(no|nope|not quite|not right|wrong|incorrect|change|fix|actually|isn'?t)\b/i;
const DONE =
  /(that'?s (everything|all|it)|that is (all|everything)|nothing else|all set|i'?m done|we'?re done)/i;

export async function handleTurn(
  session: Session,
  userText: string
): Promise<TurnResult> {
  session.messages.push({ role: "user", content: userText });

  try {
    switch (session.stage) {
      case "GREETING":
        session.stage = "COLLECTING";
        return await collectTurn(session, userText);
      case "COLLECTING":
        return await collectTurn(session, userText);
      case "READBACK":
        return await readbackTurn(session, userText);
      default:
        // DECIDING / CLOSING are terminal for P2.
        return { reply: "Thanks — we're all set here.", done: true };
    }
  } catch (err) {
    return await escalate(session, err);
  }
}

async function collectTurn(
  session: Session,
  userText: string
): Promise<TurnResult> {
  const t0 = Date.now();
  const out = await extract(session.draft, session.messages);
  const latencyMs = Date.now() - t0;

  session.draft = out.draft;
  session.lastConfidence = out.confidence;

  await logEvent({
    runId: session.runId,
    stage: "COLLECTING",
    subAgent: "extractor",
    latencyMs,
    confidence: out.confidence,
    payload: {
      updated_fields: out.updated_fields,
      needs_clarification: out.needs_clarification,
      draft: out.draft,
    },
  });

  const missing = missingFields(session.draft);
  const ready = missing.length === 0 || DONE.test(userText);

  if (ready) {
    session.stage = "READBACK";
    const reply = readback(session.draft);
    session.messages.push({ role: "assistant", content: reply });
    await logEvent({
      runId: session.runId,
      stage: "READBACK",
      subAgent: "responder",
      payload: { kind: "readback" },
    });
    return { reply, done: false };
  }

  const reply = out.needs_clarification
    ? askClarification(out.needs_clarification)
    : askForField(missing[0]!);

  session.messages.push({ role: "assistant", content: reply });
  await logEvent({
    runId: session.runId,
    stage: "COLLECTING",
    subAgent: "responder",
    payload: { kind: "clarify", asked: out.needs_clarification ? "clarification" : missing[0] },
  });
  return { reply, done: false };
}

async function readbackTurn(
  session: Session,
  userText: string
): Promise<TurnResult> {
  const yes = AFFIRMATIVE.test(userText);
  const no = NEGATIVE.test(userText);

  // Confirmed → advance to DECIDING (owned by P3). For P2, complete the run.
  if (yes && !no) {
    session.stage = "DECIDING";
    await logEvent({
      runId: session.runId,
      stage: "READBACK",
      subAgent: "system",
      payload: { event: "readback_confirmed" },
    });
    const reply =
      "Perfect — I've got the full referral. Next I'll check it against our service area, payers, and capacity.";
    session.messages.push({ role: "assistant", content: reply });
    await finalizeRun(session.runId, "completed");
    session.finalized = true;
    return { reply, done: true };
  }

  // Rejected → back to COLLECTING to capture the correction.
  if (no) {
    session.stage = "COLLECTING";
    const reply = correctionPrompt();
    session.messages.push({ role: "assistant", content: reply });
    await logEvent({
      runId: session.runId,
      stage: "COLLECTING",
      subAgent: "responder",
      payload: { kind: "correction_requested" },
    });
    return { reply, done: false };
  }

  // Ambiguous → re-ask.
  const reply = confirmPrompt();
  session.messages.push({ role: "assistant", content: reply });
  return { reply, done: false };
}

async function escalate(session: Session, err: unknown): Promise<TurnResult> {
  const message = err instanceof Error ? err.message : String(err);
  const reasonCode = err instanceof ModelError ? err.reasonCode : "MODEL_ERROR";

  await logEvent({
    runId: session.runId,
    stage: session.stage,
    subAgent: "system",
    payload: { event: "escalation", reason_code: reasonCode, error: message },
  });
  await finalizeRun(session.runId, "failed");
  session.stage = "CLOSING";
  session.finalized = true;
  return { reply: ESCALATION_LINE, done: true, escalated: true };
}
