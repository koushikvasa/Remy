"use client";

import type { RunEventRow, RunRow, SourceRow } from "../lib/types";
import {
  deriveChips,
  deriveDecision,
  deriveDraft,
  deriveEscalationStatus,
  deriveStepIndex,
} from "../lib/runState";
import { durationLabel, formatPhone } from "../lib/format";
import { StatusPill } from "./pills";
import { StageStepper } from "./StageStepper";
import { DraftGrid } from "./DraftGrid";
import { FitChips } from "./FitChips";
import { DecisionBanner } from "./DecisionBanner";

export function LiveCallPanel({
  run,
  events,
  source,
  nowMs,
}: {
  run: RunRow;
  events: RunEventRow[];
  source: SourceRow | null;
  nowMs: number;
}) {
  const draft = deriveDraft(events);
  const chips = deriveChips(events);
  const decision = deriveDecision(events);
  const stepIndex = deriveStepIndex(run, events);
  const escStatus = deriveEscalationStatus(events);

  const terminalStatus =
    run.status === "active" ? null : (run.status as "completed" | "escalated" | "failed");

  const endMs = run.ended_at ? new Date(run.ended_at).getTime() : nowMs;

  const orgName = source?.org_name ?? "Inbound referral";
  const contact = source?.contact_name ?? null;

  return (
    <section className="flex h-full flex-col gap-5 rounded-md border border-hairline bg-panel p-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-semibold tracking-tight text-ink">
              {orgName}
            </h2>
            {contact && <span className="text-sm text-muted">· {contact}</span>}
          </div>
          <div className="mt-1 font-mono text-xs text-muted">
            {formatPhone(run.caller_phone)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusPill status={run.status} />
          <div className="font-mono text-2xl tabular-nums text-ink">
            {durationLabel(run.started_at, endMs)}
          </div>
        </div>
      </div>

      {/* Stage stepper */}
      <StageStepper stepIndex={stepIndex} terminalStatus={terminalStatus} />

      {/* Referral draft grid — fills live */}
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">
          Referral Draft
        </div>
        <DraftGrid draft={draft} />
      </div>

      {/* Fit-check chips */}
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">
          Fit Checks
        </div>
        <FitChips chips={chips} />
      </div>

      {/* Decision banner */}
      <div className="mt-auto">
        {decision ? (
          <DecisionBanner decision={decision} />
        ) : (
          <div className="rounded border border-dashed border-hairline px-4 py-3 font-mono text-xs text-muted">
            Awaiting decision…
          </div>
        )}

        {escStatus && (
          <div className="mt-2 font-mono text-[11px] uppercase tracking-wider text-signal">
            Coordinator called
            {escStatus === "assigned" && (
              <span className="text-signal"> → assigned</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
