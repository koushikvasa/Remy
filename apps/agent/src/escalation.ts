import { logEvent } from "./telemetry";
import { startCall } from "./tools/twilioVoice";
import {
  claimCallout,
  getActiveCoordinator,
  referralShortCode,
} from "./coordinators";

/**
 * Escalation callout (P6). On an escalate close we place ONE outbound voice call
 * to the active on-call coordinator. Fully guarded: idempotent (one callout per
 * referral), and any failure is logged and swallowed so the inbound call path is
 * never affected (rules 4/5).
 */

export async function notifyCoordinatorOfEscalation(opts: {
  runId: string;
  referralId: string;
  reasonCode: string;
}): Promise<void> {
  const code = referralShortCode(opts.referralId);
  try {
    // Idempotency: only the first claim places a call.
    const claimed = await claimCallout(opts.referralId);
    if (!claimed) {
      await logEvent({
        runId: opts.runId,
        stage: "CLOSING",
        subAgent: "system",
        toolName: "callout",
        payload: { event: "callout_skipped", reason: "already_called", code },
      });
      return;
    }

    const coord = await getActiveCoordinator();
    if (!coord) {
      await logEvent({
        runId: opts.runId,
        stage: "CLOSING",
        subAgent: "system",
        toolName: "callout",
        payload: { event: "callout", status: "no_coordinator", code, reason_code: opts.reasonCode },
      });
      return;
    }

    const host = process.env.PUBLIC_HOST ?? "";
    const url = `https://${host}/coordinator-call?referral_id=${encodeURIComponent(opts.referralId)}`;
    const res = await startCall(coord.phone, url);

    await logEvent({
      runId: opts.runId,
      stage: "CLOSING",
      subAgent: "system",
      toolName: "callout",
      payload: {
        event: "callout",
        to_role: "coordinator",
        code,
        reason_code: opts.reasonCode,
        placed: res.ok,
        error: res.ok ? undefined : res.error,
      },
    });
  } catch (err) {
    console.error(`[escalation] callout failed: ${(err as Error).message}`);
  }
}
