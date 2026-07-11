import { ReferralDraft } from "@remy/shared";
import { Session, emptyDraft } from "./session";
import { extract, DRAFT_FIELDS, ModelError } from "./agents/extractor";
import {
  askForField,
  nextQuestion,
  confirmPrompt,
  correctionPrompt,
  politeReprompt,
  readback,
  converse,
  warmCloseLine,
  nudgeLine,
  referenceRepeat,
  newReferralPrompt,
  ESCALATION_LINE,
} from "./agents/responder";
import { answerOffscript } from "./agents/offscript";
import { runFitCheck } from "./agents/fitchecker";
import { decide, wordDecision, staticEscalation } from "./agents/decider";
import { writeReferral } from "./referrals";
import { referralShortCode } from "./coordinators";
import { notifyCoordinatorOfEscalation } from "./escalation";
import { normalizeCallback } from "./phone";
import { logEvent, finalizeRun } from "./telemetry";

/**
 * router.ts — the per-call stage machine (REMY_SPEC.md §7).
 *
 * GREETING → COLLECTING → READBACK → DECIDING → CLOSING. Confirmed readback runs
 * FitChecker + the deterministic decide() gate, then writes a referrals row.
 *
 * P7.2: the WORDING of each non-fast-path turn comes from the conversational
 * responder (converse()) — it reacts to what the caller actually said and, while
 * collecting, works the next missing field in. Control flow (stage transitions,
 * the gate, readback confirmation) stays deterministic. CLOSING is a real
 * conversational state. The responder never decides/accepts (guarded); on any
 * failure it falls back to deterministic templates (rule 5). Pure confirmations
 * at readback stay on a deterministic fast-path for latency.
 */

export interface TurnResult {
  reply: string;
  done: boolean; // conversation truly over (goodbye / silence / hard failure)
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

// CLOSING intents (P7.2).
const GOODBYE =
  /\b(bye|goodbye|good ?night|that'?s (all|it|everything)|that is (all|it)|nothing else|we'?re (all )?(good|set)|all set|no that'?s it|take care|have a (good|great|nice)|thank you|thanks|appreciate it)\b/i;
const SECOND_REFERRAL =
  /(another|second|one more|next)\s+(referral|patient|case|one)|another (referral|patient|case|one)|got another|can i give you another|i have another|one more for you/i;
const REFERENCE_REQUEST =
  /(reference|confirmation)\s+(number|code|id)|what.{0,12}(reference|confirmation)|repeat.{0,15}(reference|code|number)|(that|the) (number|code|reference) again|say (that|it) again/i;

// Backchannel / filler tokens (case-insensitive, stretched repeats allowed).
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

/** Recent conversation for the responder, excluding the just-pushed caller turn. */
function recentHistory(
  session: Session,
  userText: string
): { role: "user" | "assistant"; content: string }[] {
  const msgs = session.messages;
  const last = msgs[msgs.length - 1];
  const base =
    last && last.role === "user" && last.content === userText ? msgs.slice(0, -1) : msgs;
  return base.slice(-6);
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
  // 1. Pure backchannel → zero field updates, no extractor, no streak (fast path).
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

  // 3. Off-script coverage question → answer from tools, then resume (responder
  // weaves the answer in). Keep the question OUT of the extractor context so it
  // can't be misread as the patient's payer.
  const off = await answerOffscript(userText);
  if (off) {
    session.unparseableStreak = 0;
    session.messages.pop();
    const missing = missingFields(session.draft);
    const nextField = missing[0] ?? null;
    const fallback = nextField ? `${off.answer} ${askForField(nextField)}` : off.answer;
    const reply = await converse({
      mode: "collecting",
      draft: session.draft,
      nextField,
      userText,
      history: recentHistory(session, userText),
      toolAnswer: off.answer,
      allowAcceptance: false,
      fallback,
    });
    session.messages.push({ role: "assistant", content: reply });
    await logEvent({
      runId: session.runId,
      stage: "COLLECTING",
      subAgent: "responder",
      payload: { kind: "offscript_answer", topic: off.kind },
    });
    return { reply, done: false };
  }

  // 4. Normal extraction (unchanged, schema-validated).
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
    const reply = readback(session.draft); // deterministic — must be exact
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

  // Ask for exactly ONE missing field this turn.
  const field = missing[0]!;
  let reply: string;
  if (session.unparseableStreak === 2) {
    reply = politeReprompt(field); // couldn't parse — deterministic, safe
  } else {
    reply = await converse({
      mode: "collecting",
      draft: session.draft,
      nextField: field,
      userText,
      history: recentHistory(session, userText),
      allowAcceptance: false,
      fallback: nextQuestion(session.draft, out.updated_fields, field),
    });
  }
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

  // Fast path: a pure confirmation runs the gate immediately (no LLM).
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

  // Off-script question at readback (stage-agnostic) → answer, then re-confirm.
  const off = await answerOffscript(userText);
  if (off) {
    const reply = `${off.answer} So — did I get everything right?`;
    session.messages.push({ role: "assistant", content: reply });
    await logEvent({
      runId: session.runId,
      stage: "READBACK",
      subAgent: "responder",
      payload: { kind: "offscript_answer", topic: off.kind },
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
    await persistAndCallout(session, "completed");
    // Weave in the reference code + invite continuation. done:false so the call
    // stays open — auto-end must NEVER fire straight after the decision line.
    const codePart = session.referenceCode ? ` Your reference is ${session.referenceCode}.` : "";
    return {
      reply: `${decision.spoken_reason}${codePart} Anything else I can help you with?`,
      done: false,
    };
  }

  // Escalate → the caller's own number IS the callback (no asking). Persist the
  // referral and fire the coordinator callout right now.
  return escalateNow(session, decision.spoken_reason);
}

/**
 * Persist the referral (caller-ID = callback) and fire the coordinator callout —
 * for BOTH accepts (confirm the case, then report back to the hospital) and
 * escalations. Fire-and-forget + idempotent; Remy never asks for a callback
 * number. Returns the referral id.
 */
async function persistAndCallout(
  session: Session,
  status: "completed" | "escalated"
): Promise<string | null> {
  session.stage = "CLOSING";

  const cb = normalizeCallback(session.callerPhone);
  session.callbackPhone = cb.ok ? cb.phone : session.callerPhone;

  const referralId = await writeReferral(session, session.decision!);
  session.escalatedReferralId = referralId;
  session.referenceCode = referralId ? referralShortCode(referralId) : null;
  await finalizeRun(session.runId, status);
  session.finalized = true;

  await logEvent({
    runId: session.runId,
    stage: "CLOSING",
    subAgent: "system",
    payload: {
      event: "referral_closed",
      decision: session.decision!.decision,
      callback_source: "caller_id",
    },
  });

  if (referralId) {
    void notifyCoordinatorOfEscalation({
      runId: session.runId,
      referralId,
      reasonCode: session.decision!.reason_code,
    });
  }

  return referralId;
}

async function escalateNow(
  session: Session,
  spokenReason: string
): Promise<TurnResult> {
  await persistAndCallout(session, "escalated");
  return { reply: `${spokenReason} Anything else I can help with?`, done: false, escalated: true };
}

async function closingTurn(
  session: Session,
  userText: string
): Promise<TurnResult> {
  // Post-decision conversation (the escalation callout already fired at the
  // decision — the caller's own number is the callback, so nothing to capture).

  // Silence / backchannel → after two, close warmly.
  if (isPureFiller(userText)) {
    session.messages.pop();
    session.silentTurns += 1;
    if (session.silentTurns >= 2) return closeWarmly(session);
    return { reply: nudgeLine(), done: false };
  }
  session.silentTurns = 0;

  // Coverage / capacity question (stage-agnostic).
  const off = await answerOffscript(userText);
  if (off) {
    const decisionKind = session.decision?.decision ?? null;
    const reply = await converse({
      mode: "closing",
      draft: session.draft,
      nextField: null,
      userText,
      history: recentHistory(session, userText),
      toolAnswer: off.answer,
      decisionKind,
      referenceCode: session.referenceCode,
      allowAcceptance: decisionKind === "accept",
      fallback: `${off.answer} Anything else I can help with?`,
    });
    session.messages.push({ role: "assistant", content: reply });
    await logEvent({
      runId: session.runId,
      stage: "CLOSING",
      subAgent: "responder",
      payload: { kind: "offscript_answer", topic: off.kind },
    });
    return { reply, done: false };
  }

  // Second referral → fresh draft, same run, back to COLLECTING.
  if (SECOND_REFERRAL.test(userText)) {
    resetForNewReferral(session);
    const reply = newReferralPrompt();
    session.messages.push({ role: "assistant", content: reply });
    await logEvent({
      runId: session.runId,
      stage: "COLLECTING",
      subAgent: "system",
      payload: { event: "second_referral" },
    });
    return { reply, done: false };
  }

  // Repeat the reference code.
  if (REFERENCE_REQUEST.test(userText) && session.referenceCode) {
    const reply = referenceRepeat(session.referenceCode);
    session.messages.push({ role: "assistant", content: reply });
    return { reply, done: false };
  }

  // Goodbye → warm close + (auto-)end.
  if (GOODBYE.test(userText)) return closeWarmly(session);

  // Otherwise a next-steps / general question → answer in persona, consistently.
  const decisionKind = session.decision?.decision ?? null;
  const fallback =
    decisionKind === "accept"
      ? "Our coordinator will call the patient within the hour to set everything up — anything else I can help with?"
      : "Our coordinator will reach out within fifteen minutes — anything else I can help with?";
  const reply = await converse({
    mode: "closing",
    draft: session.draft,
    nextField: null,
    userText,
    history: recentHistory(session, userText),
    decisionKind,
    referenceCode: session.referenceCode,
    allowAcceptance: decisionKind === "accept",
    fallback,
  });
  session.messages.push({ role: "assistant", content: reply });
  return { reply, done: false };
}

function closeWarmly(session: Session): TurnResult {
  const reply = warmCloseLine();
  session.messages.push({ role: "assistant", content: reply });
  return { reply, done: true };
}

/**
 * Safety net (P7.3 BUG 1): if the call ended with an escalated referral that has
 * a callback number, make sure the coordinator callout was placed. Idempotent
 * via the callout_at claim, so it never double-dials even if the capture-point
 * fire already ran. Call this from the WS close handler.
 */
export async function ensureEscalationCallout(session: Session): Promise<void> {
  // Covers accepts and escalations — any closed referral with a callback number.
  if (session.decision && session.callbackPhone && session.escalatedReferralId) {
    await notifyCoordinatorOfEscalation({
      runId: session.runId,
      referralId: session.escalatedReferralId,
      reasonCode: session.decision.reason_code,
    });
  }
}

function resetForNewReferral(session: Session): void {
  session.draft = emptyDraft();
  session.stage = "COLLECTING";
  session.decision = null;
  session.fit = null;
  session.payerMatchedId = null;
  session.awaitingCallback = false;
  session.callbackPhone = null;
  session.unparseableStreak = 0;
  session.silentTurns = 0;
  session.finalized = false;
  session.referenceCode = null;
  session.escalatedReferralId = null;
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
  session.unparseableStreak = 0;

  await logEvent({
    runId: session.runId,
    stage: "CLOSING",
    subAgent: "decider",
    payload: { decision: "escalate", reason_code: reasonCode, source: "router" },
  });
  session.messages.push({ role: "assistant", content: decision.spoken_reason });
  return escalateNow(session, decision.spoken_reason);
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
