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
import { runFitCheck } from "./agents/fitchecker";
import { decide, wordDecision } from "./agents/decider";
import { writeReferral } from "./referrals";
import { logEvent, finalizeRun } from "./telemetry";

/**
 * router.ts — the per-call stage machine (REMY_SPEC.md §7).
 *
 * GREETING → COLLECTING → READBACK → DECIDING → CLOSING. On a confirmed readback
 * the FitChecker runs the three tools, the deterministic decide() gate produces
 * the decision, and a referrals row is written on close:
 *   - accept  → confirm, write referrals(accepted), run completed
 *   - escalate → capture a callback number, write referrals(escalated), run escalated
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
      case "CLOSING":
        return await closingTurn(session, userText);
      default:
        // DECIDING is transient (resolved within the confirming turn).
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

  // Confirmed → run the decision gate.
  if (yes && !no) {
    session.stage = "DECIDING";
    await logEvent({
      runId: session.runId,
      stage: "READBACK",
      subAgent: "system",
      payload: { event: "readback_confirmed" },
    });
    return await decideTurn(session);
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

async function decideTurn(session: Session): Promise<TurnResult> {
  const t0 = Date.now();

  // FitChecker: three DB tools → FitResult. Deterministic decide() gate.
  const { fit, payerMatchedId } = await runFitCheck(session.draft, session.runId);
  session.fit = fit;
  session.payerMatchedId = payerMatchedId;

  const gate = decide(fit, session.draft, session.lastConfidence);

  // LLM only WORDS the spoken_reason; decision/reason_code are fixed by decide().
  const decision = await wordDecision(gate, session.draft, fit);
  session.decision = decision;

  await logEvent({
    runId: session.runId,
    stage: "DECIDING",
    subAgent: "decider",
    latencyMs: Date.now() - t0,
    confidence: session.lastConfidence,
    payload: {
      decision: decision.decision,
      reason_code: decision.reason_code,
      all_green: fit.all_green,
      // PHI-safe (initial + age only); the dashboard shows it under the banner.
      spoken_reason: decision.spoken_reason,
    },
  });

  session.messages.push({ role: "assistant", content: decision.spoken_reason });

  if (decision.decision === "accept") {
    session.stage = "CLOSING";
    await writeReferral(session, decision);
    await finalizeRun(session.runId, "completed");
    session.finalized = true;
    return { reply: decision.spoken_reason, done: true };
  }

  // escalate / decline → capture a callback number, then write on close.
  session.stage = "CLOSING";
  session.awaitingCallback = true;
  return { reply: decision.spoken_reason, done: false, escalated: true };
}

async function closingTurn(
  session: Session,
  userText: string
): Promise<TurnResult> {
  if (!session.awaitingCallback || !session.decision) {
    return { reply: "Thanks — we're all set here.", done: true };
  }

  const digits = userText.replace(/[^\d+]/g, "");
  session.callbackPhone = digits.length >= 7 ? digits : userText.trim();
  session.awaitingCallback = false;

  await writeReferral(session, session.decision);
  await finalizeRun(session.runId, "escalated");
  session.finalized = true;

  await logEvent({
    runId: session.runId,
    stage: "CLOSING",
    subAgent: "system",
    payload: { event: "escalation_closed", callback_captured: true },
  });

  const reply =
    "Thanks — I've logged everything and our coordinator will call you shortly. Take care.";
  session.messages.push({ role: "assistant", content: reply });
  return { reply, done: true };
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
