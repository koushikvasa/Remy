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

function Chip({ label, info }: { label: string; info: ChipInfo }) {
  return (
    <div
      className={`flex-1 rounded border px-3 py-2 transition-colors ${STATE_STYLE[info.state]}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider">
          {label}
        </span>
        <span className="font-mono text-sm leading-none">{MARK[info.state]}</span>
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-muted">
        {info.detail ?? "pending"}
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
