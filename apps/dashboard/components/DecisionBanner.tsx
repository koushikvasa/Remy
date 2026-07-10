import type { DecisionView } from "../lib/runState";

/**
 * Full-width strip when the decider event lands. Green ACCEPTED / amber ESCALATED,
 * with the spoken_reason quoted underneath.
 */
export function DecisionBanner({ decision }: { decision: DecisionView }) {
  const accepted = decision.decision === "accept";
  const verb = accepted ? "ACCEPTED" : "ESCALATED";

  const style = accepted
    ? "border-signal/50 bg-signal/10"
    : "border-amber/50 bg-amber/10";
  const headline = accepted ? "text-signal" : "text-amber";

  return (
    <div className={`rounded border px-4 py-3 ${style}`}>
      <div className={`font-display text-lg font-semibold tracking-tight ${headline}`}>
        {verb}
        <span className="ml-2 font-mono text-sm font-normal text-muted">
          {decision.reason_code}
        </span>
      </div>
      {decision.spoken_reason && (
        <p className="mt-1 text-sm italic text-ink/80">
          “{decision.spoken_reason}”
        </p>
      )}
    </div>
  );
}
