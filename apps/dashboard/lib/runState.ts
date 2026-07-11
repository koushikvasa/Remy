import type { ReferralDraft, RunEventRow, RunRow } from "./types";

/**
 * Pure derivation: fold a run's run_events into the live view state
 * (draft, fit chips, decision, stage). No side effects — used by both the live
 * hero and the /runs/[id] trace page.
 */

export const STEPPER = [
  "GREETING",
  "COLLECTING",
  "READBACK",
  "DECIDING",
  "CLOSED",
] as const;
export type Step = (typeof STEPPER)[number];

export const DRAFT_FIELDS = [
  "patient_first_initial",
  "patient_age",
  "diagnosis_summary",
  "discipline_needed",
  "payer_raw",
  "zip",
  "requested_start",
] as const;

export const EMPTY_DRAFT: ReferralDraft = {
  patient_first_initial: null,
  patient_age: null,
  diagnosis_summary: null,
  discipline_needed: null,
  payer_raw: null,
  zip: null,
  requested_start: null,
};

function sortedBySeq(events: RunEventRow[]): RunEventRow[] {
  return [...events].sort((a, b) => a.seq - b.seq);
}

/** Latest extractor draft, or the empty draft if none yet. */
export function deriveDraft(events: RunEventRow[]): ReferralDraft {
  const extractorEvents = sortedBySeq(events).filter(
    (e) => e.sub_agent === "extractor" && e.payload && e.payload.draft
  );
  const last = extractorEvents[extractorEvents.length - 1];
  if (!last) return EMPTY_DRAFT;
  return { ...EMPTY_DRAFT, ...(last.payload!.draft as Partial<ReferralDraft>) };
}

export type ChipState = "pending" | "pass" | "fail";

export interface ChipInfo {
  state: ChipState;
  detail: string | null;
}

export interface FitChips {
  serviceArea: ChipInfo;
  payer: ChipInfo;
  capacity: ChipInfo;
}

function toolResult(events: RunEventRow[], tool: string): Record<string, unknown> | null {
  const ev = sortedBySeq(events)
    .filter((e) => e.sub_agent === "fitchecker" && e.tool_name === tool)
    .pop();
  const result = ev?.payload?.result as Record<string, unknown> | undefined;
  return result ?? null;
}

export function deriveChips(events: RunEventRow[]): FitChips {
  const area = toolResult(events, "serviceArea");
  const payer = toolResult(events, "payer");
  const cap = toolResult(events, "capacity");

  const areaChip: ChipInfo = area
    ? {
        state: area.covered === true ? "pass" : "fail",
        detail: (area.county as string) ?? "not covered",
      }
    : { state: "pending", detail: null };

  const payerChip: ChipInfo = payer
    ? {
        state: payer.accepted === true ? "pass" : "fail",
        detail:
          (payer.matchedName as string) ??
          (payer.accepted === false ? "not accepted" : "unrecognized"),
      }
    : { state: "pending", detail: null };

  const capChip: ChipInfo = cap
    ? {
        state: cap.available === true ? "pass" : "fail",
        detail:
          cap.openSlots != null ? `${cap.openSlots} open` : "none",
      }
    : { state: "pending", detail: null };

  return { serviceArea: areaChip, payer: payerChip, capacity: capChip };
}

export interface DecisionView {
  decision: "accept" | "escalate" | "decline";
  reason_code: string;
  spoken_reason: string | null;
}

export function deriveDecision(events: RunEventRow[]): DecisionView | null {
  const ev = sortedBySeq(events)
    .filter((e) => e.sub_agent === "decider")
    .pop();
  if (!ev || !ev.payload) return null;
  return {
    decision: ev.payload.decision as DecisionView["decision"],
    reason_code: (ev.payload.reason_code as string) ?? "",
    spoken_reason: (ev.payload.spoken_reason as string) ?? null,
  };
}

const STAGE_TO_STEP: Record<string, number> = {
  GREETING: 0,
  COLLECTING: 1,
  READBACK: 2,
  DECIDING: 3,
  CLOSING: 4,
};

/** Current stepper index (0..4). Terminal runs are CLOSED (4). */
export function deriveStepIndex(run: RunRow, events: RunEventRow[]): number {
  if (run.status !== "active") return 4;
  const last = sortedBySeq(events)[events.length - 1];
  if (!last || !last.stage) return 0;
  return STAGE_TO_STEP[last.stage] ?? 0;
}

export function isEscalationReason(decision: DecisionView | null): boolean {
  return decision?.decision !== "accept";
}

/** Callout chain status from the run's events (P6): called → assigned → notified. */
export function deriveEscalationStatus(
  events: RunEventRow[]
): "called" | "assigned" | "notified" | null {
  const evs = sortedBySeq(events);
  if (
    evs.some(
      (e) => e.tool_name === "source_notify" && e.payload && e.payload.event === "source_notify" && e.payload.placed
    )
  )
    return "notified";
  if (evs.some((e) => e.payload && e.payload.event === "assigned")) return "assigned";
  if (
    evs.some(
      (e) => e.tool_name === "callout" && e.payload && e.payload.event === "callout" && e.payload.placed
    )
  )
    return "called";
  return null;
}
