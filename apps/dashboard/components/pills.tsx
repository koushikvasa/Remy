import type { RunStatus } from "../lib/types";

const STATUS_STYLES: Record<RunStatus, string> = {
  active: "text-signal border-signal/40 bg-signal/10",
  completed: "text-signal border-signal/30 bg-signal/5",
  escalated: "text-amber border-amber/40 bg-amber/10",
  failed: "text-danger border-danger/40 bg-danger/10",
};

export function StatusPill({ status }: { status: RunStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${STATUS_STYLES[status]}`}
    >
      {status === "active" && (
        <span
          aria-hidden="true"
          className="live-pulse h-1.5 w-1.5 rounded-full bg-signal"
        />
      )}
      {status}
    </span>
  );
}

const DECISION_STYLES: Record<string, string> = {
  accepted: "text-signal border-signal/40 bg-signal/10",
  escalated: "text-amber border-amber/40 bg-amber/10",
  declined: "text-danger border-danger/40 bg-danger/10",
};

export function DecisionPill({ decision }: { decision: string | null }) {
  if (!decision) return <span className="text-muted">—</span>;
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
        DECISION_STYLES[decision] ?? "text-muted border-hairline"
      }`}
    >
      {decision}
    </span>
  );
}

/** Assigned = escalated referral a coordinator took. Green OUTLINE (no fill),
 * distinct from accepted's filled-green pill. */
export function AssignedPill() {
  return (
    <span className="inline-flex items-center rounded border border-signal bg-transparent px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-signal">
      assigned
    </span>
  );
}
