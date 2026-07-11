import "dotenv/config";
import { createInterface } from "node:readline";
import { ReferralDraft } from "@remy/shared";
import { startSession, GREETING } from "../src/session";
import { handleTurn } from "../src/router";
import { finalizeRun } from "../src/telemetry";

/**
 * simulate.ts — drive the router from the terminal, no Twilio (CLAUDE.md testing
 * shortcuts). Type user turns; see Remy's reply and the ReferralDraft after each.
 *
 * It creates REAL runs / run_events rows in Supabase, exactly like a live call,
 * so the dashboard (P4) will show a simulated conversation identically.
 *
 * Usage:  pnpm --filter @remy/agent sim [--phone +15551234567]
 * (on this machine, prefix with NODE_OPTIONS=--use-system-ca for TLS)
 *
 * Chatty-caller test (reads like two humans):
 *   pnpm --filter @remy/agent sim < scripts/chatty-caller.txt
 */

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1
  );
  return sorted[Math.max(0, idx)];
}

const FIELD_LABELS: Record<keyof ReferralDraft, string> = {
  patient_first_initial: "initial",
  patient_age: "age",
  diagnosis_summary: "dx",
  discipline_needed: "discipline",
  payer_raw: "payer",
  zip: "zip",
  requested_start: "start",
};

function printDraft(draft: ReferralDraft): void {
  const line = (Object.keys(FIELD_LABELS) as (keyof ReferralDraft)[])
    .map((f) => {
      const v = draft[f];
      const mark = v === null || v === undefined ? "·" : "✓";
      const val = v === null || v === undefined ? "—" : String(v);
      return `${mark} ${FIELD_LABELS[f]}=${val}`;
    })
    .join("  ");
  console.log(`   draft: ${line}`);
}

async function main(): Promise<void> {
  const phone = getArg("--phone") ?? "+15551234567";

  console.log("─".repeat(72));
  console.log("Remy simulator — type a caller turn and press enter. 'exit' to quit.");
  console.log("─".repeat(72));

  const session = await startSession({ callerPhone: phone, sourceId: null });
  console.log(`\nRemy> ${GREETING}`);
  console.log(`   [run ${session.runId} · stage ${session.stage}]`);

  const rl = createInterface({ input: process.stdin });
  process.stdout.write("\nyou> ");

  const latencies: number[] = [];

  for await (const raw of rl) {
    const text = raw.trim();
    if (!text) {
      process.stdout.write("you> ");
      continue;
    }
    if (text === "exit" || text === "quit") break;

    console.log(`\nCaller> ${text}`);
    const res = await handleTurn(session, text);
    if (typeof res.latencyMs === "number") latencies.push(res.latencyMs);
    console.log(`Remy>   ${res.reply}`);
    printDraft(session.draft);
    if (session.decision) {
      console.log(
        `   decision: ${session.decision.decision.toUpperCase()} / ${session.decision.reason_code}`
      );
    }
    console.log(
      `   [stage ${session.stage} · conf ${session.lastConfidence.toFixed(2)} · turn ${
        res.latencyMs ?? "?"
      }ms${res.escalated ? " · ESCALATED" : ""}]`
    );

    if (res.done) {
      console.log(`\n— conversation complete (run ${session.runId}) —`);
      rl.close();
      break;
    }
    process.stdout.write("\nyou> ");
  }

  rl.close();
  if (!session.finalized) {
    await finalizeRun(session.runId, "completed");
  }

  if (latencies.length > 0) {
    console.log(
      `\nturn latency (n=${latencies.length}): p50 ${percentile(latencies, 50)}ms · ` +
        `p95 ${percentile(latencies, 95)}ms · max ${Math.max(...latencies)}ms`
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("simulator error:", err);
  process.exit(1);
});
