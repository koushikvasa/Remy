"use client";

import { useEffect, useMemo, useState } from "react";
import { getBrowserClient } from "../lib/supabase";
import type {
  ReferralRow,
  RunEventRow,
  RunRow,
  SourceRow,
} from "../lib/types";
import { isRecent } from "../lib/format";
import { LiveCallPanel } from "./LiveCallPanel";
import { EmptyState } from "./EmptyState";
import { ReferralQueue } from "./ReferralQueue";
import { EventFeed } from "./EventFeed";
import { EconomicsStrip } from "./EconomicsStrip";

// How long a finished call stays in the hero before returning to the empty state.
const RECENT_WINDOW_MS = 120_000;

function TopBar({ activeCount }: { activeCount: number }) {
  return (
    <header className="flex items-center justify-between px-1">
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-lg font-semibold tracking-tight text-ink">
          Remy
        </h1>
        <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-muted">
          Command Center
        </span>
      </div>
      <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            activeCount > 0 ? "live-pulse bg-signal" : "bg-hairline"
          }`}
        />
        {activeCount > 0 ? `${activeCount} live` : "idle"}
      </div>
    </header>
  );
}

export function CommandCenter() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [sourcesByPhone, setSourcesByPhone] = useState<Record<string, SourceRow>>({});
  const [eventsByRun, setEventsByRun] = useState<Record<string, RunEventRow[]>>({});
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // 1Hz clock for durations / "time ago".
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Initial load + realtime subscriptions (no polling).
  useEffect(() => {
    const supabase = getBrowserClient();
    let cancelled = false;

    async function load() {
      const [runsRes, refsRes, srcRes] = await Promise.all([
        supabase.from("runs").select("*").order("started_at", { ascending: false }).limit(25),
        supabase.from("referrals").select("*").order("created_at", { ascending: false }).limit(25),
        supabase.from("referral_sources").select("*"),
      ]);
      if (cancelled) return;

      const runsList = (runsRes.data ?? []) as RunRow[];
      setRuns(runsList);
      setReferrals((refsRes.data ?? []) as ReferralRow[]);

      const byPhone: Record<string, SourceRow> = {};
      for (const s of (srcRes.data ?? []) as SourceRow[]) byPhone[s.phone] = s;
      setSourcesByPhone(byPhone);

      const focus = runsList.find((r) => r.status === "active") ?? runsList[0];
      if (focus) {
        const { data } = await supabase
          .from("run_events")
          .select("*")
          .eq("run_id", focus.run_id)
          .order("seq", { ascending: true });
        if (!cancelled && data) {
          setEventsByRun((prev) => ({ ...prev, [focus.run_id]: data as RunEventRow[] }));
        }
      }
    }
    void load();

    const channel = supabase
      .channel("command-center")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "run_events" },
        (payload) => {
          const ev = payload.new as RunEventRow;
          setEventsByRun((prev) => {
            const existing = prev[ev.run_id] ?? [];
            if (existing.some((e) => e.id === ev.id)) return prev;
            return { ...prev, [ev.run_id]: [...existing, ev] };
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runs" },
        (payload) => {
          const run = payload.new as RunRow;
          if (!run?.run_id) return;
          setRuns((prev) => {
            const rest = prev.filter((r) => r.run_id !== run.run_id);
            return [run, ...rest].sort(
              (a, b) =>
                new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
            );
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "referrals" },
        (payload) => {
          const ref = payload.new as ReferralRow;
          if (!ref?.id) return;
          // INSERT prepends; UPDATE (e.g. assignment) replaces in place.
          setReferrals((prev) => {
            const idx = prev.findIndex((r) => r.id === ref.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = ref;
              return copy;
            }
            return [ref, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, []);

  const focusRun = useMemo<RunRow | null>(() => {
    if (runs.length === 0) return null;
    return runs.find((r) => r.status === "active") ?? runs[0];
  }, [runs]);

  // Backfill events if we focus a run we haven't loaded yet.
  useEffect(() => {
    if (!focusRun || eventsByRun[focusRun.run_id]) return;
    const supabase = getBrowserClient();
    let cancelled = false;
    void supabase
      .from("run_events")
      .select("*")
      .eq("run_id", focusRun.run_id)
      .order("seq", { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) {
          setEventsByRun((prev) =>
            prev[focusRun.run_id]
              ? prev
              : { ...prev, [focusRun.run_id]: data as RunEventRow[] }
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [focusRun, eventsByRun]);

  const focusEvents = focusRun ? eventsByRun[focusRun.run_id] ?? [] : [];
  const source =
    focusRun?.caller_phone ? sourcesByPhone[focusRun.caller_phone] ?? null : null;

  const showHero =
    !!focusRun &&
    (focusRun.status === "active" ||
      isRecent(focusRun.ended_at, nowMs, RECENT_WINDOW_MS));

  const activeCount = runs.filter((r) => r.status === "active").length;

  return (
    <main className="mx-auto flex h-screen max-w-[1600px] flex-col gap-4 p-4">
      <TopBar activeCount={activeCount} />

      <EconomicsStrip referrals={referrals} runs={runs} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-h-0 lg:col-span-2">
          {showHero && focusRun ? (
            <LiveCallPanel
              run={focusRun}
              events={focusEvents}
              source={source}
              nowMs={nowMs}
            />
          ) : (
            <EmptyState />
          )}
        </div>

        <div className="grid min-h-0 grid-rows-2 gap-4">
          <ReferralQueue referrals={referrals} nowMs={nowMs} />
          <EventFeed events={focusEvents} />
        </div>
      </div>
    </main>
  );
}
