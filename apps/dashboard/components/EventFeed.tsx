"use client";

import { useEffect, useRef } from "react";
import type { RunEventRow } from "../lib/types";

const AGENT_COLOR: Record<string, string> = {
  extractor: "text-ink",
  fitchecker: "text-signal",
  decider: "text-amber",
  responder: "text-muted",
  system: "text-muted",
};

/** Live run_events tail in mono. Auto-scrolls, newest at bottom. */
export function EventFeed({ events }: { events: RunEventRow[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sorted = [...events].sort((a, b) => a.seq - b.seq);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <section className="flex min-h-[16rem] flex-col rounded-md border border-hairline bg-panel lg:min-h-0">
      <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="font-display text-sm font-semibold tracking-tight">
          Event Feed
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
          run_events
        </span>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed"
      >
        {sorted.length === 0 && (
          <div className="px-1 py-4 text-center text-muted">no events</div>
        )}
        {sorted.map((e) => (
          <div key={e.id ?? `${e.run_id}-${e.seq}`} className="flex gap-2 py-0.5">
            <span className="w-6 shrink-0 text-right text-muted/60">{e.seq}</span>
            <span className="w-20 shrink-0 text-muted">{e.stage ?? "—"}</span>
            <span
              className={`w-16 shrink-0 ${AGENT_COLOR[e.sub_agent ?? ""] ?? "text-muted"}`}
            >
              {e.sub_agent ?? "—"}
            </span>
            <span className="flex-1 truncate text-muted">
              {e.tool_name ?? ""}
            </span>
            {e.latency_ms != null && (
              <span className="shrink-0 text-muted/70">{e.latency_ms}ms</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
