import { ReferralDraft } from "@remy/shared";
import { Session } from "./session";
import { extract, DRAFT_FIELDS, ModelError } from "./agents/extractor";
import {
  askForField,
  nextQuestion,
  confirmPrompt,
  correctionPrompt,
  politeReprompt,
  readback,
  ESCALATION_LINE,
} from "./agents/responder";
import { answerOffscript } from "./agents/offscript";
import { runFitCheck } from "./agents/fitchecker";
import { decide, wordDecision, staticEscalation } from "./agents/decider";
import { writeReferral } from "./referrals";
import { referralShortCode } from "./coordinators";
import { notifyCoordinatorOfEscalation } from "./escalation";
import { logEvent, finalizeRun } from "./telemetry";

/**
 * router.ts — the per-call stage machine (REMY_SPEC.md §7).
 *
 * GREETING → COLLECTING → READBACK → DECIDING → CLOSING. Confirmed readback runs
 * FitChecker + the deterministic decide() gate, then writes a referrals row.
 *
 * P5 additions (COLLECTING branch only, no new stage): off-script coverage
 * questions are answered from the tools then collection resumes; an explicit
 * human request or three unparseable turns escalate; one missing field is asked
 * per turn. Every turn is timed (prompt received → reply ready) and logged.
 *
 * Every turn is wrapped so a model failure never leaves dead air (rule 5).
 */

export interface TurnResult {
  reply: string;
  done: boolean; // conversation over (completed or escalated closed)
  escalated?: boolean;
  latencyMs?: number; // total turn latency, stamped by handleTurn
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
const HUMAN_REQUEST =
  /(speak|talk|connect|transfer|get) (me )?(to )?(a |an |the )?(human|person|someone|representative|rep|agent|coordinator|operator)|real person|human being/i;

// Backchannel / filler tokens (case-insensitive, stretched repeats allowed).
// An utterance made ENTIRELY of these carries no referral content.
const FILLER_TOKEN =
  /^(m+|h+m+|m+h+m*|hm+|mhm+|u+h+|uh|huh|okay|ok|k|mkay|yeah|yea|yep|yup|yes|right|sure|got|it|alright|cool|oh|ah|aha|so|well|um|uhm|erm|er)$/i;

/** True when the whole utterance is pure backchannel (no substantive content). */
function isPureFiller(text: string): boolean {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true; // empty / silence
  return tokens.every((t) => FILLER_TOKEN.test(t));
}

export async function handleTurn(
  session: Session,
  userText: string
): Promise<TurnResult> {
  const t0 = Date.now(); // prompt received
  session.messages.push({ role: "user", content: userText });

  let res: TurnResult;
  try {
    res = await route(session, userText);
  } catch (err) {
    res = await escalate(session, err);
  }

  res.latencyMs = Date.now() - t0; // reply ready
  await logEvent({
    runId: session.runId,
    stage: session.stage,
    subAgent: "router",
    toolName: "turn",
    latencyMs: res.latencyMs,
  });
  return res;
}

async function route(session: Session, userText: string): Promise<TurnResult> {
  switch (session.stage) {
    case "GREETING":
      session.stage = "COLLECTING";
      return collectTurn(session, userText);
    case "COLLECTING":
      return collectTurn(session, userText);
    case "READBACK":
      return readbackTurn(session, userText);
    case "CLOSING":
      return closingTurn(session, userText);
    default:
      return { reply: "Thanks — we're all set here.", done: true };
  }
}

async function collectTurn(
  session: Session,
  userText: string
): Promise<TurnResult> {
  // 1. Pure backchannel ("mm-hmm", "okay", "yeah") → zero field updates, does
  // NOT run the extractor and does NOT count toward the nonsense streak. This is
  // the highest-probability live-call bug: fillers must never mutate the draft.
  if (isPureFiller(userText)) {
    session.messages.pop(); // keep filler out of the extractor context
    const missing = missingFields(session.draft);
    const reply = missing.length > 0 ? askForField(missing[0]!) : confirmPrompt();
    await logEvent({
      runId: session.runId,
      stage: "COLLECTING",
      subAgent: "responder",
      payload: { kind: "filler_ignored" },
    });
    return { reply, done: false };
  }

  // 2. Explicit request for a human → escalate.
  if (HUMAN_REQUEST.test(userText)) {
    return escalateToHuman(session, "CALLER_REQUESTED_HUMAN");
  }

  // 3. Off-script coverage question → answer from tools, then resume collection.
  const off = await answerOffscript(userText);
  if (off) {
    session.unparseableStreak = 0;
    // Keep the coverage question OUT of the extractor's context — otherwise
    // "do you take Humana?" gets misread as the patient's payer. Drop the
    // just-pushed question and don't add the answer to the transcript.
    session.messages.pop();
    const missing = missingFields(session.draft);
    const reply =
      missing.length > 0 ? `${off.answer} ${askForField(missing[0]!)}` : off.answer;
    await logEvent({
      runId: session.runId,
      stage: "COLLECTING",
      subAgent: "responder",
      payload: { kind: "offscript_answer", topic: off.kind },
    });
    return { reply, done: false };
  }

  // 4. Normal extraction.
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
    session.unparseableStreak = 0;
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

  // Not ready — track whether this turn produced anything.
  if (out.updated_fields.length > 0) {
    session.unparseableStreak = 0;
  } else {
    session.unparseableStreak += 1;
  }

  // Third strike of nothing parseable → offer a human.
  if (session.unparseableStreak >= 3) {
    return escalateToHuman(session, "CALLER_REQUESTED_HUMAN");
  }

  // Ask for exactly ONE missing field this turn (with an acknowledgment).
  const field = missing[0]!;
  const reply =
    session.unparseableStreak === 2
      ? politeReprompt(field)
      : nextQuestion(session.draft, out.updated_fields, field);
  session.messages.push({ role: "assistant", content: reply });
  await logEvent({
    runId: session.runId,
    stage: "COLLECTING",
    subAgent: "responder",
    payload: { kind: "clarify", asked: field, streak: session.unparseableStreak },
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
    return decideTurn(session);
  }

  // Rejected → back to COLLECTING for a targeted correction.
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
      spoken_reason: decision.spoken_reason,
    },
  });

  session.messages.push({ role: "assistant", content: decision.spoken_reason });

  if (decision.decision === "accept") {
    session.stage = "CLOSING";
    const referralId = await writeReferral(session, decision);
    await finalizeRun(session.runId, "completed");
    session.finalized = true;
    // Weave in the reference code (deterministic; doesn't touch the gate).
    const reply = referralId
      ? `${decision.spoken_reason} Your reference is ${referralShortCode(referralId)}.`
      : decision.spoken_reason;
    return { reply, done: true };
  }

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

  const referralId = await writeReferral(session, session.decision);
  await finalizeRun(session.runId, "escalated");
  session.finalized = true;

  await logEvent({
    runId: session.runId,
    stage: "CLOSING",
    subAgent: "system",
    payload: { event: "escalation_closed", callback_captured: true },
  });

  // P6: call the on-call coordinator. Safe if voice/coordinators are unavailable.
  if (referralId) {
    await notifyCoordinatorOfEscalation({
      runId: session.runId,
      referralId,
      reasonCode: session.decision.reason_code,
    });
  }

  const reply =
    "Perfect — you'll hear from us within fifteen minutes. Thanks so much for your patience.";
  session.messages.push({ role: "assistant", content: reply });
  return { reply, done: true };
}

/**
 * Router-level escalation (human request / repeated unparseable turns). Always
 * escalate, never accept — decide() remains the only path to an accept (rule 1).
 */
async function escalateToHuman(
  session: Session,
  reasonCode: Parameters<typeof staticEscalation>[0]
): Promise<TurnResult> {
  const decision = staticEscalation(reasonCode);
  session.decision = decision;
  session.stage = "CLOSING";
  session.awaitingCallback = true;
  session.unparseableStreak = 0;

  await logEvent({
    runId: session.runId,
    stage: "CLOSING",
    subAgent: "decider",
    payload: { decision: "escalate", reason_code: reasonCode, source: "router" },
  });
  session.messages.push({ role: "assistant", content: decision.spoken_reason });
  return { reply: decision.spoken_reason, done: false, escalated: true };
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
