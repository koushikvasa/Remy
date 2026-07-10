import { supabase } from "./db";
import { redactPayload } from "./redact";

/**
 * telemetry.ts — run + event writes (REMY_SPEC.md §5).
 *
 * createRun / logEvent / finalizeRun are used identically by the live WS call
 * path and by the simulator, so a simulated referral produces exactly the same
 * runs / run_events rows a real call would.
 *
 * Telemetry must never take down a call: a failed write is logged to stderr and
 * swallowed (no throw). The only hard-failure path is createRun (no run = no call).
 */

// Monotonic per-run sequence counter (in-process; one process handles one run at
// a time in the simulator, and keyed by runId for the live server).
const seqByRun = new Map<string, number>();

export interface CreateRunInput {
  callerPhone: string;
  sourceId?: string | null;
}

export async function createRun(input: CreateRunInput): Promise<string> {
  const { data, error } = await supabase()
    .from("runs")
    .insert({
      caller_phone: input.callerPhone,
      source_id: input.sourceId ?? null,
      status: "active",
    })
    .select("run_id")
    .single();

  if (error || !data) {
    throw new Error(`createRun failed: ${error?.message ?? "no row returned"}`);
  }
  seqByRun.set(data.run_id, 0);
  return data.run_id as string;
}

export interface EventInput {
  runId: string;
  stage: string; // GREETING | COLLECTING | READBACK | DECIDING | CLOSING
  subAgent: string; // extractor | fitchecker | decider | responder | system
  toolName?: string | null;
  latencyMs?: number | null;
  confidence?: number | null;
  payload?: unknown; // REDACTED before write
}

export async function logEvent(e: EventInput): Promise<void> {
  const seq = (seqByRun.get(e.runId) ?? 0) + 1;
  seqByRun.set(e.runId, seq);

  const payload = e.payload === undefined ? null : redactPayload(e.payload);

  const { error } = await supabase()
    .from("run_events")
    .insert({
      run_id: e.runId,
      seq,
      stage: e.stage,
      sub_agent: e.subAgent,
      tool_name: e.toolName ?? null,
      latency_ms: e.latencyMs ?? null,
      confidence: e.confidence ?? null,
      payload,
    });

  if (error) {
    // Never break the call over a telemetry failure.
    console.error(`[telemetry] logEvent failed (run ${e.runId}, seq ${seq}): ${error.message}`);
  }
}

export type RunStatus = "active" | "completed" | "failed" | "escalated";

export async function finalizeRun(runId: string, status: RunStatus): Promise<void> {
  const { error } = await supabase()
    .from("runs")
    .update({ status, ended_at: new Date().toISOString() })
    .eq("run_id", runId);

  if (error) {
    console.error(`[telemetry] finalizeRun failed (run ${runId}): ${error.message}`);
  }
}
