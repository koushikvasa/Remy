import type { ReferralRow, RunRow } from "../lib/types";

/**
 * Economics strip (P6) — computed from referrals + runs. Same tokens: mono
 * numbers, one green accent, no new colors. Empty DB shows dashes, never NaN.
 */

const EPISODE_VALUE = 3000; // avg Medicare home-health episode (assumption)

// After-hours = outside 9am–5pm ET, or weekend, in America/New_York.
function isAfterHoursET(iso: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const weekend = wd === "Sat" || wd === "Sun";
  return weekend || hour < 9 || hour >= 17;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function Tile({
  label,
  value,
  sub,
  accent,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  title?: string;
}) {
  return (
    <div className="flex-1 rounded-md border border-hairline bg-panel px-4 py-3" title={title}>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
        {label}
        {title && <span className="ml-1 cursor-help text-muted/60">ⓘ</span>}
      </div>
      <div
        className={`mt-1 font-mono text-2xl tabular-nums ${accent ? "text-signal" : "text-ink"}`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 font-mono text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function EconomicsStrip({
  referrals,
  runs,
}: {
  referrals: ReferralRow[];
  runs: RunRow[];
}) {
  // Captured = accepted, plus escalated referrals a coordinator took (assigned).
  const captured = referrals.filter(
    (r) =>
      r.decision === "accepted" ||
      (r.decision === "escalated" && r.assigned_to)
  ).length;
  const revenue = captured * EPISODE_VALUE;

  const afterHours = referrals.filter((r) => isAfterHoursET(r.created_at)).length;

  const durations = runs
    .filter((r) => r.ended_at)
    .map((r) => (new Date(r.ended_at as string).getTime() - new Date(r.started_at).getTime()) / 1000)
    .filter((s) => s > 0 && s < 3600);
  const medianSecs = Math.round(median(durations));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Tile
        label="Revenue captured"
        value={`$${revenue.toLocaleString("en-US")}`}
        sub={`${captured} captured`}
        accent
        title={`Assumption: $${EPISODE_VALUE.toLocaleString("en-US")} avg Medicare home-health episode × (accepted + assigned) referrals.`}
      />
      <Tile
        label="After-hours captures"
        value={`${afterHours}`}
        sub="outside 9–5 ET"
      />
      <Tile
        label="Median time-to-decision"
        value={durations.length ? `${medianSecs}s` : "—"}
        sub="industry: ~45 min"
      />
    </div>
  );
}
