import type { ChipInfo, FitChips as FitChipsType } from "../lib/runState";

const STATE_STYLE: Record<ChipInfo["state"], string> = {
  pending: "border-hairline bg-panel text-muted",
  pass: "border-signal/40 bg-signal/10 text-signal",
  fail: "border-amber/40 bg-amber/10 text-amber",
};

const MARK: Record<ChipInfo["state"], string> = {
  pending: "•",
  pass: "✓",
  fail: "✗",
};

const STATE_WORD: Record<ChipInfo["state"], string> = {
  pending: "checking",
  pass: "passed",
  fail: "needs review",
};

function Chip({ label, info }: { label: string; info: ChipInfo }) {
  const detail = info.detail ?? "pending";
  return (
    <div
      role="status"
      aria-label={`${label}: ${STATE_WORD[info.state]}${info.detail ? ` — ${info.detail}` : ""}`}
      className={`flex-1 rounded-md border px-3 py-2 transition-colors ${STATE_STYLE[info.state]}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wider">
          {label}
        </span>
        <span aria-hidden="true" className="font-mono text-sm leading-none">
          {MARK[info.state]}
        </span>
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-muted">
        {detail}
      </div>
    </div>
  );
}

export function FitChips({ chips }: { chips: FitChipsType }) {
  return (
    <div className="flex gap-2">
      <Chip label="Service Area" info={chips.serviceArea} />
      <Chip label="Payer" info={chips.payer} />
      <Chip label="Capacity" info={chips.capacity} />
    </div>
  );
}
