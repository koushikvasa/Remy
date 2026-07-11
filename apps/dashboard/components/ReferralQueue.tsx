import type { ReferralRow } from "../lib/types";
import { disciplineLabel, formatPhone, timeAgo } from "../lib/format";
import { DecisionPill, AssignedPill } from "./pills";

/** The "mock EMR" — latest referrals as compact rows. */
export function ReferralQueue({
  referrals,
  nowMs,
}: {
  referrals: ReferralRow[];
  nowMs: number;
}) {
  return (
    <section
      aria-label="Referral queue"
      className="flex min-h-[18rem] flex-col rounded-md border border-hairline bg-panel shadow-panel lg:min-h-0"
    >
      <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h2 className="font-display text-sm font-semibold tracking-tight">
          Referral Queue
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
          mock EMR
        </span>
      </header>

      <div className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
        {referrals.length === 0 && (
          <div className="px-4 py-6 text-center font-mono text-xs text-muted">
            no referrals yet
          </div>
        )}
        {referrals.map((r) => (
          <div key={r.id} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-ink">
                  {r.patient_first_initial ?? "?"}
                  {r.patient_age != null ? `·${r.patient_age}` : ""}
                </span>
                <span className="text-xs text-muted">
                  {disciplineLabel(r.discipline_needed)}
                </span>
              </div>
              {r.decision === "escalated" && r.assigned_to ? (
                <AssignedPill />
              ) : (
                <DecisionPill decision={r.decision} />
              )}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 truncate font-mono text-[11px] text-muted">
                <span className="truncate">{r.payer_raw ?? "—"}</span>
                <span aria-hidden="true" className="text-muted/50">·</span>
                <span>{r.zip ?? "—"}</span>
                {r.reason_code && (
                  <>
                    <span aria-hidden="true" className="text-muted/50">·</span>
                    <span className="text-muted/80">{r.reason_code}</span>
                  </>
                )}
              </div>
              <span className="shrink-0 font-mono text-[11px] text-muted">
                {timeAgo(r.created_at, nowMs)}
              </span>
            </div>
            {r.decision === "escalated" && r.callback_phone && (
              <div className="mt-1 font-mono text-[11px] text-amber">
                ↳ callback {formatPhone(r.callback_phone)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
