"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserClient } from "../lib/supabase";
import type {
  ReferralRow,
  RunEventRow,
  RunRow,
  SourceRow,
} from "../lib/types";
import { LiveCallPanel } from "./LiveCallPanel";

function FullEventTable({ events }: { events: RunEventRow[] }) {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  return (
    <section className="rounded-md border border-hairline bg-panel">
      <header className="border-b border-hairline px-4 py-2.5">
        <h3 className="font-display text-sm font-semibold tracking-tight">
          Full Event Trace
        </h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="border-b border-hairline text-left text-muted">
              <th className="px-3 py-2 font-normal">seq</th>
              <th className="px-3 py-2 font-normal">stage</th>
              <th className="px-3 py-2 font-normal">sub_agent</th>
              <th className="px-3 py-2 font-normal">tool</th>
              <th className="px-3 py-2 text-right font-normal">latency</th>
              <th className="px-3 py-2 text-right font-normal">conf</th>
              <th className="px-3 py-2 font-normal">payload</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {sorted.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="px-3 py-1.5 text-muted/60">{e.seq}</td>
                <td className="px-3 py-1.5">{e.stage ?? "—"}</td>
                <td className="px-3 py-1.5 text-signal">{e.sub_agent ?? "—"}</td>
                <td className="px-3 py-1.5 text-muted">{e.tool_name ?? ""}</td>
                <td className="px-3 py-1.5 text-right text-muted">
                  {e.latency_ms != null ? `${e.latency_ms}ms` : ""}
                </td>
                <td className="px-3 py-1.5 text-right text-muted">
                  {e.confidence != null ? e.confidence.toFixed(2) : ""}
                </td>
                <td className="max-w-[420px] truncate px-3 py-1.5 text-muted/80">
                  {e.payload ? JSON.stringify(e.payload) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RunTrace({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [events, setEvents] = useState<RunEventRow[]>([]);
  const [referral, setReferral] = useState<ReferralRow | null>(null);
  const [source, setSource] = useState<SourceRow | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const supabase = getBrowserClient();
    let cancelled = false;

    async function load() {
      const [runRes, evRes, refRes] = await Promise.all([
        supabase.from("runs").select("*").eq("run_id", runId).maybeSingle(),
        supabase.from("run_events").select("*").eq("run_id", runId).order("seq", { ascending: true }),
        supabase.from("referrals").select("*").eq("run_id", runId).maybeSingle(),
      ]);
      if (cancelled) return;

      const runRow = (runRes.data as RunRow | null) ?? null;
      if (!runRow) {
        setNotFound(true);
        return;
      }
      setRun(runRow);
      setEvents((evRes.data ?? []) as RunEventRow[]);
      setReferral((refRes.data as ReferralRow | null) ?? null);
      setNowMs(Date.now());

      if (runRow.caller_phone) {
        const { data } = await supabase
          .from("referral_sources")
          .select("*")
          .eq("phone", runRow.caller_phone)
          .maybeSingle();
        if (!cancelled) setSource((data as SourceRow | null) ?? null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-4">
      <header className="flex items-center justify-between px-1">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="font-mono text-xs text-muted hover:text-ink">
            ← Command Center
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
            Decision Trace
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted">{runId}</span>
      </header>

      {notFound && (
        <div className="rounded-md border border-hairline bg-panel px-4 py-6 text-center font-mono text-sm text-muted">
          run not found
        </div>
      )}

      {run && (
        <>
          <div className="lg:h-[560px]">
            <LiveCallPanel
              run={run}
              events={events}
              source={source}
              nowMs={nowMs}
            />
          </div>
          {referral?.decision === "escalated" && referral.callback_phone && (
            <div className="rounded-md border border-amber/40 bg-amber/10 px-4 py-2 font-mono text-xs text-amber">
              escalated · callback captured
            </div>
          )}
          <FullEventTable events={events} />
        </>
      )}
    </main>
  );
}
