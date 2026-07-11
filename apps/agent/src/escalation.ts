import { logEvent } from "./telemetry";
import { supabase } from "./db";
import { startCall } from "./tools/twilioVoice";
import {
  claimCallout,
  claimSourceNotify,
  getActiveCoordinator,
  getEscalatedReferral,
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

async function sourcePhoneForReferral(referralId: string): Promise<string | null> {
  const r = await getEscalatedReferral(referralId);
  if (!r) return null;
  if (r.callback_phone) return r.callback_phone;
  if (r.source_id) {
    const { data } = await supabase()
      .from("referral_sources")
      .select("phone")
      .eq("id", r.source_id)
      .maybeSingle();
    if (data?.phone) return data.phone as string;
  }
  return null;
}

/**
 * Third leg: after assignment, call the referral source back with an update.
 * Idempotent (one notify per referral), guarded — never blocks the assignment.
 */
export async function notifySourceOfAssignment(opts: {
  runId: string | null;
  referralId: string;
}): Promise<void> {
  const code = referralShortCode(opts.referralId);
  const log = (payload: Record<string, unknown>) =>
    opts.runId
      ? logEvent({
          runId: opts.runId,
          stage: "CLOSING",
          subAgent: "system",
          toolName: "source_notify",
          payload,
        })
      : Promise.resolve();

  try {
    const claimed = await claimSourceNotify(opts.referralId);
    if (!claimed) {
      await log({ event: "source_notify_skipped", reason: "already_notified", code });
      return;
    }

    const phone = await sourcePhoneForReferral(opts.referralId);
    if (!phone) {
      await log({ event: "source_notify", status: "no_source_phone", code });
      return;
    }

    const host = process.env.PUBLIC_HOST ?? "";
    const url = `https://${host}/source-notify?referral_id=${encodeURIComponent(opts.referralId)}`;
    const res = await startCall(phone, url);
    await log({ event: "source_notify", code, placed: res.ok, error: res.ok ? undefined : res.error });
  } catch (err) {
    console.error(`[escalation] source notify failed: ${(err as Error).message}`);
  }
}
