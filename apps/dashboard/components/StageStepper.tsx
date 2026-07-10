import { STEPPER } from "../lib/runState";

/**
 * GREETING → COLLECTING → READBACK → DECIDING → CLOSED.
 * Current stage glows; completed stages are checked.
 *
 * All Tailwind classes are written statically (no `text-${x}`) so the JIT emits
 * them.
 */

type Accent = "signal" | "amber" | "danger";

const CURRENT_LABEL: Record<Accent, string> = {
  signal: "text-signal",
  amber: "text-amber",
  danger: "text-danger",
};
const CURRENT_DOT: Record<Accent, string> = {
  signal: "border-signal bg-signal/15 text-signal shadow-glow",
  amber: "border-amber bg-amber/15 text-amber",
  danger: "border-danger bg-danger/15 text-danger",
};

export function StageStepper({
  stepIndex,
  terminalStatus,
}: {
  stepIndex: number;
  terminalStatus: "completed" | "escalated" | "failed" | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-y-2">
      {STEPPER.map((label, i) => {
        const done = i < stepIndex;
        const current = i === stepIndex;
        const isClosed = i === STEPPER.length - 1;

        const accent: Accent =
          isClosed && current && terminalStatus === "escalated"
            ? "amber"
            : isClosed && current && terminalStatus === "failed"
              ? "danger"
              : "signal";

        const labelClass = current
          ? CURRENT_LABEL[accent]
          : done
            ? "text-ink"
            : "text-muted";
        const dotClass = current
          ? CURRENT_DOT[accent]
          : done
            ? "border-signal/40 bg-signal/10 text-signal"
            : "border-hairline bg-panel text-muted";

        return (
          <div key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full border text-[9px] transition-colors ${dotClass}`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={`font-mono text-[10px] uppercase tracking-wider transition-colors ${labelClass}`}
              >
                {label}
              </span>
            </div>
            {i < STEPPER.length - 1 && (
              <span
                className={`mx-1 h-px w-5 ${done ? "bg-signal/40" : "bg-hairline"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
