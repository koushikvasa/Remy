"use client";

import { useEffect, useMemo, useState } from "react";
import { getBrowserClient } from "../lib/supabase";
import type {
  MedicalAssistantRow,
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
import { ThemeToggle } from "./ThemeToggle";
import { MedicalAssistants } from "./MedicalAssistants";
import { Logo } from "./Logo";

// How long a finished call stays in the hero before returning to the empty state.
const RECENT_WINDOW_MS = 120_000;

function TopBar({ activeCount }: { activeCount: number }) {
  const live = activeCount > 0;
  return (
    <header className="flex items-center justify-between px-1">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="sr-only">Remy Command Center</h1>
        <Logo />
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.3em] text-muted sm:inline">
          Command Center
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 font-mono text-xs text-muted"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              live ? "live-pulse bg-signal" : "bg-hairline"
            }`}
          />
          {live ? `${activeCount} call${activeCount > 1 ? "s" : ""} live` : "Idle — line open"}
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function CommandCenter() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [sourcesByPhone, setSourcesByPhone] = useState<Record<string, SourceRow>>({});
  const [eventsByRun, setEventsByRun] = useState<Record<string, RunEventRow[]>>({});
  const [assistants, setAssistants] = useState<MedicalAssistantRow[]>([]);
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
      const [runsRes, refsRes, srcRes, maRes] = await Promise.all([
        supabase.from("runs").select("*").order("started_at", { ascending: false }).limit(25),
        supabase.from("referrals").select("*").order("created_at", { ascending: false }).limit(25),
        supabase.from("referral_sources").select("*"),
        // Table may not exist yet — supabase returns an error, not a throw, so
        // this is safe; the component falls back to sample data when empty.
        supabase.from("medical_assistants").select("*").order("code"),
      ]);
      if (cancelled) return;

      const runsList = (runsRes.data ?? []) as RunRow[];
      setRuns(runsList);
      setReferrals((refsRes.data ?? []) as ReferralRow[]);
      setAssistants((maRes.data ?? []) as MedicalAssistantRow[]);

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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "medical_assistants" },
        (payload) => {
          const row = payload.new as MedicalAssistantRow;
          if (!row?.id) return;
          // Availability flips update the roster row in place.
          setAssistants((prev) => {
            const idx = prev.findIndex((a) => a.id === row.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = row;
              return copy;
            }
            return [...prev, row];
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
    <main
      id="main"
      aria-label="Remy Command Center"
      className="mx-auto flex min-h-[100dvh] max-w-[1600px] flex-col gap-3 overflow-x-hidden p-3 sm:gap-4 sm:p-4"
    >
      {/* Console — fills the viewport on desktop with internal-scroll panels;
          flows naturally (page scrolls) on smaller screens. */}
      <div className="flex flex-col gap-3 sm:gap-4 lg:h-[calc(100dvh-2rem)] lg:min-h-0 lg:overflow-hidden">
        <TopBar activeCount={activeCount} />

        <EconomicsStrip referrals={referrals} runs={runs} />

        <div className="grid flex-1 grid-cols-1 gap-3 sm:gap-4 lg:min-h-0 lg:grid-cols-3">
          <div className="min-h-[60vh] lg:col-span-2 lg:min-h-0">
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

          <ReferralQueue referrals={referrals} nowMs={nowMs} />
        </div>

        <EventFeed events={focusEvents} />
      </div>

      {/* Staffing roster — scrolls into view below the console. */}
      <MedicalAssistants assistants={assistants} />
    </main>
  );
}
