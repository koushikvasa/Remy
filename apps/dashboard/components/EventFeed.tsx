"use client";

import { useEffect, useRef } from "react";
import type { RunEventRow } from "../lib/types";

/**
 * Event timeline — the run's telemetry as a left→right sequence of connected
 * nodes (a horizontal "the machine working" ticker). Newest node is on the
 * right and pulses; the strip auto-scrolls to it. Full-width, fixed-height,
 * horizontally scrollable — reads the same on phone and projector.
 */

const AGENT_DOT: Record<string, string> = {
  extractor: "bg-ink",
  fitchecker: "bg-signal",
  decider: "bg-amber",
  responder: "bg-muted",
  system: "bg-muted",
};
const AGENT_TEXT: Record<string, string> = {
  extractor: "text-ink",
  fitchecker: "text-signal",
  decider: "text-amber",
  responder: "text-muted",
  system: "text-muted",
};

export function EventFeed({ events }: { events: RunEventRow[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sorted = [...events].sort((a, b) => a.seq - b.seq);

  // Auto-scroll to the newest node (rightmost).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [events.length]);

  return (
    <section
      aria-label="Event timeline"
      className="flex shrink-0 flex-col rounded-md border border-hairline bg-panel shadow-panel"
    >
      <header className="flex items-center justify-between border-b border-hairline px-4 py-2">
        <h2 className="font-display text-sm font-semibold tracking-tight">
          Event Timeline
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
          run_events
        </span>
      </header>

      <div
        ref={scrollRef}
        role="log"
        aria-label="Live run events, most recent last"
        className="overflow-x-auto overflow-y-hidden px-4 py-3"
      >
        {sorted.length === 0 ? (
          <div className="flex h-[76px] items-center font-mono text-[11px] text-muted">
            no events yet
          </div>
        ) : (
          <ol className="flex min-w-max items-start">
            {sorted.map((e, i) => {
              const agent = e.sub_agent ?? "";
              const dot = AGENT_DOT[agent] ?? "bg-muted";
              const text = AGENT_TEXT[agent] ?? "text-muted";
              const last = i === sorted.length - 1;
              return (
                <li
                  key={e.id ?? `${e.run_id}-${e.seq}`}
                  className="flex w-[136px] shrink-0 flex-col"
                >
                  {/* Rail: dot + connector to the next node. */}
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot} ${
                        last ? "live-pulse" : ""
                      }`}
                    />
                    {!last && (
                      <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
                    )}
                  </div>
                  {/* Node label. */}
                  <div className="mt-2 flex flex-col gap-0.5 pr-3">
                    <div className="flex items-baseline gap-1.5">
                      <span className={`font-mono text-[11px] font-medium ${text}`}>
                        {agent || "—"}
                      </span>
                      {e.latency_ms != null && (
                        <span className="font-mono text-[10px] text-muted/70">
                          {e.latency_ms}ms
                        </span>
                      )}
                    </div>
                    <span className="truncate font-mono text-[10px] uppercase tracking-wide text-muted">
                      {e.stage ?? "—"}
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted/80">
                      {e.tool_name || "·"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
